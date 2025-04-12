// ==UserScript==
// @name         ChatGPT File Uploader + GitHub
// @namespace    https://github.com/Clad3815/chatgpt-file-uploader
// @version      4.0.2
// @updateURL    https://github.com/Clad3815/chatgpt-file-uploader/raw/refs/heads/main/src/chatgpt-upload-files-plugin.user.js
// @downloadURL  https://github.com/Clad3815/chatgpt-file-uploader/raw/refs/heads/main/src/chatgpt-upload-files-plugin.user.js
// @description  Adds true file upload capabilities to ChatGPT with preview, syntax highlighting, and proper file handling. Upload local files/folders or from GitHub using a stepper-based modal flow - features not available in the standard interface.
// @match        https://chatgpt.com/*
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      github.com
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @require      https://cdn.jsdelivr.net/npm/jquery@3.6.4/dist/jquery.min.js
// ==/UserScript==

(function () {
    'use strict';

    //------------------------------------------------------------------
    // 0) Inject necessary CSS (jsTree + minimal custom)
    //------------------------------------------------------------------

    const jstreeCss = GM_getResourceText('JSTREE_CSS');
    if (jstreeCss) {
        GM_addStyle(jstreeCss);
    }

    // Minimal required custom CSS (only what can't be done with Tailwind)
    GM_addStyle(`
        /* Minimal spinner animation */
        @keyframes spin { 0% { transform:rotate(0deg); } 100% { transform:rotate(360deg); } }
        .my-spinner { animation: spin 1s linear infinite; }

        /* Custom Tree View */
        .tree-view {
            font-size: 0.875rem;
            user-select: none;
        }
        
        .tree-item {
            display: flex;
            align-items: center;
            padding: 4px 0;
        }
        
        .tree-item:hover {
            background: rgba(0, 0, 0, 0.05);
        }
        
        .tree-indent {
            width: 24px;
            height: 100%;
            display: inline-block;
        }
        
        .tree-toggle {
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: #666;
        }
        
        .tree-toggle:hover {
            color: #000;
        }
        
        .tree-icon {
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 6px;
        }
        
        .tree-checkbox {
            margin-right: 6px;
        }
        
        .tree-label {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* Tree View Animations */
        .tree-children {
            overflow: hidden;
            transition: height 0.2s ease-in-out;
        }

        .tree-children.collapsed {
            height: 0 !important;
        }

        .tree-toggle svg {
            transition: transform 0.2s ease-in-out;
        }

        .tree-toggle.expanded svg {
            transform: rotate(90deg);
        }
    `);

    //------------------------------------------------------------------
    // 1) Globals & utility
    //------------------------------------------------------------------
    let uploadedFiles = [];          // current batch of chosen files
    const processedMessages = {};    // to store which messages we've already parsed for <user_attachments>

    function createEl(tag, {
        className = '',
        text = '',
        html = '',
        attrs = {},
        children = [],
        style = ''
    } = {}) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text) el.textContent = text;
        if (html) el.innerHTML = html;
        if (style) el.style = style;
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        for (const c of children) el.appendChild(c);
        return el;
    }

    function formatFileSize(bytes) {
        if (!bytes || typeof bytes !== 'number' || isNaN(bytes)) return '';
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatFileDetails(fileInfo) {
        const parts = [];
        if (fileInfo.modifyTime) parts.push(`Modified on ${fileInfo.modifyTime}`);
        if (fileInfo.size) parts.push(fileInfo.size);
        return parts.join(' • ');
    }

    // Reads a File object from the browser into text
    async function readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                resolve({
                    content: e.target.result,
                    modifyTime: new Date(file.lastModified).toLocaleString(),
                    size: formatFileSize(file.size)
                });
            };
            reader.onerror = (err) => reject(err);
            reader.readAsText(file);
        });
    }

    // For syntax highlight with Prism
    function getLanguageFromExtension(ext) {
        const map = { js: 'javascript', py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown' };
        return map[ext] || null;
    }

    //------------------------------------------------------------------
    // [NEW] 1b) Build ASCII representation of the repo structure
    //------------------------------------------------------------------
    function buildRepoStructureASCII(githubTree) {
        // 1) Convert { path, type='tree'|'blob' }[] into a nested object
        const root = {};

        for (const item of githubTree) {
            const { path } = item;
            const parts = path.split('/');
            let cur = root;
            for (let i = 0; i < parts.length; i++) {
                const segment = parts[i];
                if (!cur[segment]) {
                    cur[segment] = {};
                }
                cur = cur[segment];
            }
        }

        // 2) DFS to build ASCII lines
        function buildLines(node, prefix = '', isLast = true) {
            const keys = Object.keys(node).sort();
            let lines = [];
            keys.forEach((key, idx) => {
                const lastEntry = (idx === keys.length - 1);
                const branchChar = lastEntry ? '└── ' : '├── ';
                const childPrefix = prefix + (isLast ? '    ' : '│   ');
                lines.push(prefix + branchChar + key);

                // Recurse if sub-nodes
                if (Object.keys(node[key]).length > 0) {
                    lines = lines.concat(buildLines(node[key], childPrefix, lastEntry));
                }
            });
            return lines;
        }

        // 3) If you want a single top-level label, you can do so:
        // For example, 'repo/'
        const topKeys = Object.keys(root).sort();
        let resultLines = ['repo/'];
        topKeys.forEach((k, idx) => {
            const isLast = (idx === topKeys.length - 1);
            const branchChar = isLast ? '└── ' : '├── ';
            const childPrefix = '    ';
            resultLines.push(branchChar + k);

            if (Object.keys(root[k]).length > 0) {
                resultLines.push(...buildLines(root[k], childPrefix, isLast));
            }
        });

        return resultLines.join('\n');
    }

    //------------------------------------------------------------------
    // 2) Show file "View content" modal
    //------------------------------------------------------------------
    function showModal(fileName, fileContent, fileInfo) {
        // remove old
        let overlay = document.getElementById('files-modal-overlay');
        if (overlay) overlay.remove();

        overlay = createEl('div', {
            attrs: { id: 'files-modal-overlay' },
            className: `
                fixed inset-0 bg-black bg-opacity-50 z-[9999]
                flex items-center justify-center
                opacity-0 transition-opacity duration-200
            `
        });

        const modal = createEl('div', {
            className: `
                w-[600px] max-w-[90vw] max-h-[80vh]
                bg-white dark:bg-gray-800
                text-gray-900 dark:text-gray-100
                border border-gray-200 dark:border-gray-700
                rounded-xl shadow-lg
                flex flex-col
            `
        });

        // Header
        const header = createEl('div', {
            className: 'px-4 py-3 text-lg font-semibold border-b border-gray-200 dark:border-gray-700'
        });
        const titleBox = createEl('div', { className: 'flex-1' });
        const title = createEl('div', { className: 'font-semibold', text: fileName });
        const details = createEl('div', { className: 'text-xs text-token-text-secondary mt-1', text: formatFileDetails(fileInfo) });
        titleBox.appendChild(title);
        titleBox.appendChild(details);

        const closeBtn = createEl('button', {
            className: `
                text-sm px-3 py-1
                bg-token-main-surface-secondary dark:bg-token-main-surface-primary
                border border-token-border-light dark:border-token-border-dark
                rounded hover:bg-[#f0f0f0] cursor-pointer
            `,
            text: 'Close'
        });
        closeBtn.addEventListener('click', () => overlay.remove());
        header.append(titleBox, closeBtn);

        // Content
        const content = createEl('div', {
            className: 'p-4 flex-1 overflow-y-auto transition-all duration-300'
        });
        const pre = createEl('pre', {
            className: `
                whitespace-pre-wrap break-words
                text-token-text-primary bg-token-main-surface-secondary
                p-2 rounded border border-token-border-light
                overflow-auto
            `
        });
        pre.textContent = fileContent;
        content.appendChild(pre);

        modal.append(header, content);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // animate
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            modal.style.transform = 'scale(1)';
        });
    }

    //------------------------------------------------------------------
    // 3) Preview panel + add / remove
    //------------------------------------------------------------------
    function removeFile(fileIndex) {
        uploadedFiles.splice(fileIndex, 1);
        updatePreview();
    }

    function updatePreview() {
        const ta = document.querySelector('#prompt-textarea');
        if (!ta) return;

        // Find the container where the textarea and potential file previews reside
        const composerContainer = ta.closest('.relative.flex.w-full.flex-auto.flex-col');
        if (!composerContainer) return;

        // Define IDs for our containers
        const outerContainerId = 'files-pill-outer-container';
        const rowContainerId = 'files-pill-row-container';

        // Get or create the outer container for the pills
        let outerContainer = composerContainer.querySelector(`#${outerContainerId}`);

        if (uploadedFiles.length > 0) {
            if (!outerContainer) {
                outerContainer = createEl('div', {
                    attrs: { id: outerContainerId },
                    className: 'mb-3 flex flex-col gap-2' // Adjusted margin bottom
                });

                const rowContainer = createEl('div', {
                    attrs: { id: rowContainerId },
                    className: '-ms-1\\.5 flex flex-nowrap gap-2 overflow-x-auto p-1\\.5' // Ensure no-scrollbar is removed
                });

                outerContainer.appendChild(rowContainer);

                // Insert the container *before* the textarea's grid container
                const textareaGrid = composerContainer.querySelector('.relative.ms-1\\.5.grid');
                if (textareaGrid) {
                    composerContainer.insertBefore(outerContainer, textareaGrid);
                } else {
                    // Fallback: insert at the beginning of the composer container
                    composerContainer.insertBefore(outerContainer, composerContainer.firstChild);
                }
            }

            // Get the row container (it must exist now)
            const rowContainer = outerContainer.querySelector(`#${rowContainerId}`);
            if (!rowContainer) return; // Should not happen

            // Clear previous pills
            rowContainer.innerHTML = '';

            // Add current pills
            uploadedFiles.forEach((file, index) => {
                // Ensure the file object has the index for the remove function
                file.index = index;
                const pillElement = createFileBlock(file, true); // Pass true to show delete button
                rowContainer.appendChild(pillElement);
            });

        } else {
            // If no files, remove the outer container if it exists
            if (outerContainer) {
                outerContainer.remove();
            }
        }
    }

    // Helper pour créer un bloc de fichier (maintenant unifié et style "pilule")
    function createFileBlock(file, showDelete = false) {
        const blockWrapper = createEl('div', {
            className: `group text-token-text-primary relative inline-block text-sm`
        });

        const mainBlock = createEl('div', {
            className: `
                border-token-border-light bg-token-main-surface-primary
                relative overflow-visible border rounded-lg
                cursor-pointer hover:bg-token-main-surface-secondary transition-colors
                w-64 // Fixed width for consistency in horizontal layout
            `
        });

        const content = createEl('div', {
            className: 'p-2'
        });

        const flexRow = createEl('div', {
            className: 'flex flex-row items-center gap-2'
        });

        const iconContainer = createEl('div', {
            className: 'relative h-8 w-8 shrink-0 flex items-center justify-center rounded-lg bg-token-main-surface-secondary text-token-text-secondary' // Adjusted icon style
        });
        iconContainer.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
            </svg>
        `;

        const infoContainer = createEl('div', {
            className: 'overflow-hidden flex-1'
        });
        const fileName = createEl('div', {
            className: 'truncate font-medium text-xs', // Smaller font
            text: file.name.split('/').pop()
        });
        const fileDetails = createEl('div', {
            className: 'text-token-text-secondary truncate text-xs mt-0.5',
            text: formatFileDetails(file)
        });
        infoContainer.append(fileName, fileDetails);

        flexRow.append(iconContainer, infoContainer);
        content.appendChild(flexRow);
        mainBlock.appendChild(content);
        blockWrapper.appendChild(mainBlock);

        mainBlock.addEventListener('click', (ev) => {
            // Prevent modal from opening if delete button is clicked
            if (ev.target.closest('.delete-file-btn')) return;
            showModal(file.name, file.content, file);
        });

        if (showDelete) {
            const delBtn = createEl('button', {
                className: `
                    delete-file-btn
                    absolute end-1 top-1 -translate-y-1/2 translate-x-1/2
                    rounded-full transition-opacity
                    border-[3px] border-token-main-surface-primary dark:border-token-main-surface-secondary // Match background
                    bg-token-main-surface-tertiary dark:bg-token-main-surface-tertiary // Button background
                    p-[2px] text-token-text-secondary dark:text-token-text-primary // Icon color
                    opacity-0 group-hover:opacity-100 // Show on hover
                `,
                attrs: {
                    title: 'Remove file'
                }
            });
            delBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 29 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M7.30286 6.80256C7.89516 6.21026 8.85546 6.21026 9.44775 6.80256L14.5003 11.8551L19.5529 6.80256C20.1452 6.21026 21.1055 6.21026 21.6978 6.80256C22.2901 7.39485 22.2901 8.35515 21.6978 8.94745L16.6452 14L21.6978 19.0526C22.2901 19.6449 22.2901 20.6052 21.6978 21.1974C21.1055 21.7897 20.1452 21.7897 19.5529 21.1974L14.5003 16.1449L9.44775 21.1974C8.85546 21.7897 7.89516 21.7897 7.30286 21.1974C6.71057 20.6052 6.71057 19.6449 7.30286 19.0526L12.3554 14L7.30286 8.94745C6.71057 8.35515 6.71057 7.39485 7.30286 6.80256Z" fill="currentColor"></path>
                </svg>
            `;
            delBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                removeFile(file.index); // Assumes file object has index property
            });
            blockWrapper.appendChild(delBtn);
        }

        return blockWrapper;
    }

    //------------------------------------------------------------------
    // 4) Insert attachments on send
    //------------------------------------------------------------------
    async function insertFilesIntoTextarea() {
        if (uploadedFiles.length === 0) return;
        const ta = document.querySelector('#prompt-textarea');
        if (!ta) return;

        let attachXML = '\n<user_attachments>';
        for (const f of uploadedFiles) {
            attachXML += `\n  <attachment name="${f.name}" last_edit="${f.modifyTime}" size="${f.size}">\n${f.content}\n  </attachment>`;
        }
        attachXML += '\n</user_attachments>\n\n';

        const currentText = ta.innerText;
        ta.innerHTML = '';
        const p = document.createElement('p');
        p.appendChild(document.createTextNode(attachXML + currentText));
        ta.appendChild(p);
        ta.dispatchEvent(new Event('input', { bubbles: true }));

        // clear the batch
        uploadedFiles = [];
        updatePreview();
    }

    function interceptSend() {
        const sendBtn = document.querySelector('button[data-testid="send-button"]');
        if (!sendBtn) return;

        if (!sendBtn.dataset.tampermonkeyInjected) {
            sendBtn.dataset.tampermonkeyInjected = 'true';
            sendBtn.addEventListener('click', async () => {
                if (uploadedFiles.length > 0) {
                    await insertFilesIntoTextarea();
                }
            }, { capture: true });
        }

        const ta = document.querySelector('#prompt-textarea');
        if (ta && !ta.dataset.tampermonkeyEnterHooked) {
            ta.dataset.tampermonkeyEnterHooked = 'true';
            ta.addEventListener('keydown', async (ev) => {
                if (ev.key === 'Enter' && !ev.shiftKey) {
                    if (uploadedFiles.length > 0) {
                        await insertFilesIntoTextarea();
                    }
                }
            }, { capture: true });
        }
    }

    //------------------------------------------------------------------
    // 5) Parsing <user_attachments> in user messages
    //------------------------------------------------------------------
    function processUserMessage(msgEl) {
        const msgId = msgEl.getAttribute('data-message-id');
        if (!msgId) return;

        const textEl = msgEl.querySelector('.whitespace-pre-wrap');
        if (!textEl) return;

        const origText = textEl.textContent || '';
        if (processedMessages[msgId] && processedMessages[msgId].originalText === origText) return;

        const reOuter = /<user_attachments>([\s\S]*?)<\/user_attachments>/g;
        const reAttach = /<attachment name="([^"]+)" last_edit="([^"]+)" size="([^"]+)">\s*([\s\S]*?)\s*<\/attachment>/g;

        let newText = origText;
        const foundFiles = [];

        let outerMatch;
        while ((outerMatch = reOuter.exec(origText)) !== null) {
            const content = outerMatch[1];
            let attachMatch;
            while ((attachMatch = reAttach.exec(content)) !== null) {
                const fileName = attachMatch[1];
                const modifyTime = attachMatch[2];
                const size = attachMatch[3];
                const fileContent = attachMatch[4];
                foundFiles.push({ name: fileName, modifyTime, size, content: fileContent });
            }
            newText = newText.replace(outerMatch[0], '');
        }
        textEl.textContent = newText.trim();

        if (foundFiles.length > 0) {
            // show a block below the message
            let container = msgEl.querySelector('.parsed-files-container');
            if (container) container.remove();
            container = createEl('div', { className: 'parsed-files-container mt-3 mb-4' });

            // Header avec compteur et toggle
            const header = createEl('div', {
                className: 'flex items-center justify-between mb-2',
                html: `
                    <div class="text-xs text-token-text-secondary font-medium flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                            <polyline points="13 2 13 9 20 9"/>
                        </svg>
                        Files shared (${foundFiles.length})
                    </div>
                    <button class="text-xs text-token-text-secondary hover:text-token-text-primary transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2" class="transform transition-transform rotate(-90deg)">
                            <path d="M19 9l-7 7-7-7"/>
                        </svg>
                    </button>
                `
            });
            container.appendChild(header);

            // Wrapper pour les fichiers
            const wrapper = createEl('div', {
                className: 'overflow-hidden transition-all duration-300',
                style: 'max-height: 0px;'
            });

            // Grouper par dossier
            const filesByFolder = {};
            foundFiles.forEach(file => {
                const parts = file.name.split('/');
                const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
                if (!filesByFolder[folder]) filesByFolder[folder] = [];
                filesByFolder[folder].push(file);
            });

            // Créer les groupes
            Object.entries(filesByFolder).forEach(([folder, files]) => {
                if (folder) {
                    const folderGroup = createEl('div', {
                        className: 'border border-token-border-light rounded-lg mb-2'
                    });

                    const folderHeader = createEl('div', {
                        className: `
                            flex items-center justify-between p-2
                            bg-token-main-surface-secondary cursor-pointer
                            hover:bg-opacity-70 rounded-t-lg
                        `,
                        html: `
                            <div class="flex items-center gap-2">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" stroke-width="2" class="transform transition-transform">
                                    <path d="M19 9l-7 7-7-7"/>
                                </svg>
                                <span class="text-xs font-medium">${folder} (${files.length})</span>
                            </div>
                        `
                    });

                    const folderContent = createEl('div', {
                        className: 'p-2 border-t border-token-border-light'
                    });

                    let isFolderExpanded = true;
                    folderHeader.addEventListener('click', () => {
                        isFolderExpanded = !isFolderExpanded;
                        folderContent.style.display = isFolderExpanded ? 'block' : 'none';
                        folderHeader.querySelector('svg').style.transform =
                            isFolderExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
                    });

                    files.forEach(file => {
                        folderContent.appendChild(createFileBlock(file));
                    });

                    folderGroup.append(folderHeader, folderContent);
                    wrapper.appendChild(folderGroup);
                } else {
                    files.forEach(file => {
                        wrapper.appendChild(createFileBlock(file));
                    });
                }
            });

            container.appendChild(wrapper);

            // Toggle global
            const toggleBtn = header.querySelector('button');
            let isExpanded = false;
            toggleBtn.addEventListener('click', () => {
                isExpanded = !isExpanded;
                wrapper.style.maxHeight = isExpanded ? wrapper.scrollHeight + 'px' : '0px';
                toggleBtn.querySelector('svg').style.transform =
                    isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
            });

            textEl.parentElement.insertBefore(container, textEl.nextSibling);
        }

        processedMessages[msgId] = { originalText: origText, filesFound: foundFiles };
    }

    function observeUserMessages() {
        const chatContainer = document.body;
        const mo = new MutationObserver(() => {
            const userMsgs = document.querySelectorAll('[data-message-author-role="user"]');
            userMsgs.forEach(m => processUserMessage(m));
        });
        mo.observe(chatContainer, { childList: true, subtree: true });
    }

    //------------------------------------------------------------------
    // 6) GitHub import - Stepper-based flow
    //------------------------------------------------------------------
    function parseGithubUrl(url) {
        const out = { owner: null, repo: null, branch: null };
        try {
            const u = new URL(url);
            const seg = u.pathname.split('/').filter(Boolean);
            if (seg.length >= 2) {
                out.owner = seg[0];
                out.repo = seg[1];
            }
            if (seg.length >= 4 && seg[2] === 'tree') {
                out.branch = seg[3];
            }
        } catch (e) { /* ignore*/ }
        return out;
    }

    function getDefaultBranch(owner, repo) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://api.github.com/repos/${owner}/${repo}`,
                onload: (res) => {
                    if (res.status !== 200) return reject(new Error('GitHub API error: ' + res.status));
                    const data = JSON.parse(res.responseText || '{}');
                    if (!data.default_branch) return reject(new Error('No default_branch in response.'));
                    resolve(data.default_branch);
                },
                onerror: (err) => reject(err)
            });
        });
    }

    function fetchRepoTree(owner, repo, branch) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
                onload: (res) => {
                    if (res.status !== 200) return reject(new Error('Tree fetch error: ' + res.status));
                    const data = JSON.parse(res.responseText || '{}');
                    resolve(data.tree || []);
                },
                onerror: (err) => reject(err)
            });
        });
    }

    function fetchFileContentRaw(owner, repo, branch, path) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
                onload: (res) => {
                    if (res.status === 200) resolve(res.responseText);
                    else reject(new Error(`Error fetching ${path}: ${res.status}`));
                },
                onerror: (err) => reject(err)
            });
        });
    }

    const IGNORED_NAMES = ['.env', '.git', '.gitignore', 'node_modules', 'package-lock.json'];
    function buildJsTreeData(githubTree) {
        const nodeIndex = {};
        const data = [];

        function ensureFolder(folderPath) {
            if (nodeIndex[folderPath]) return;
            const fId = 'folder:' + folderPath;
            const i = folderPath.lastIndexOf('/');
            let parent = null, name = folderPath;
            if (i >= 0) {
                parent = folderPath.slice(0, i);
                name = folderPath.slice(i + 1);
            }
            nodeIndex[folderPath] = {
                id: fId,
                parent: parent ? 'folder:' + parent : '#',
                text: name,
                type: 'folder',
                state: { opened: false, checked: false }
            };
            if (parent) ensureFolder(parent);
        }

        for (const item of githubTree) {
            const { path, type } = item;
            const parts = path.split('/');
            if (type === 'tree') {
                ensureFolder(path);
            } else if (type === 'blob') {
                if (parts.length > 1) {
                    ensureFolder(parts.slice(0, -1).join('/'));
                }
                const fileName = parts[parts.length - 1];
                const parent = (parts.length > 1) ? 'folder:' + parts.slice(0, -1).join('/') : '#';
                const fileId = 'file:' + path;
                const isIgnored = IGNORED_NAMES.some(ign => fileName === ign);
                nodeIndex[fileId] = {
                    id: fileId,
                    parent,
                    text: fileName,
                    type: 'file',
                    li_attr: { 'data-file-ref': path },
                    state: { opened: false, checked: !isIgnored }
                };
            }
        }

        for (const k in nodeIndex) data.push(nodeIndex[k]);
        return data;
    }

    // The stepper modal
    /******************************************************
     * Nouveau showGitHubStepperModal() avec design épuré
     ******************************************************/
    async function showGitHubStepperModal() {
        return new Promise((resolve) => {
            // 1) Supprime l'overlay si elle existe déjà
            let oldOverlay = document.getElementById('github-flow-overlay');
            if (oldOverlay) oldOverlay.remove();

            // 2) Crée une overlay pleine page, légèrement grisée
            //    (pour le fond derrière la popup).
            const overlay = createEl('div', {
                attrs: { id: 'github-flow-overlay' },
                className: `
          fixed inset-0
          z-[9999]
          bg-black/50
          flex items-center justify-center
          opacity-0
          transition-opacity duration-300
        `
            });

            // 3) Popup principale « à la ChatGPT »,
            //    centrée et de taille max 680px (comme test_popup.html),
            //    mais pas trop haute (max-h-[80vh]).
            const modal = createEl('div', {
                attrs: { role: 'dialog', 'data-state': 'open', tabindex: '-1', 'aria-modal': 'true' },
                className: `
          popover relative
          w-full
          max-w-[680px]
          max-h-[80vh]
          bg-token-main-surface-primary
          text-start
          rounded-2xl
          shadow-xl
          flex flex-col
          overflow-hidden
          focus:outline-none
          transform scale-95
        `,
                style: `
          pointer-events: auto;
        `
            });

            // === HEADER ===
            const header = createEl('div', {
                className: `
          flex items-center justify-between
          border-b border-black/10 dark:border-white/10
          px-4 pb-4 pt-5 sm:p-6
        `
            });

            // Titre
            const headerLeft = createEl('div', { className: 'flex items-center' });
            const titleBox = createEl('div', { className: 'flex grow flex-col gap-1' });
            const headerTitle = createEl('h2', {
                className: 'text-lg font-semibold leading-6 text-token-text-primary',
                text: 'Import from GitHub'
            });
            titleBox.appendChild(headerTitle);
            headerLeft.appendChild(titleBox);
            header.appendChild(headerLeft);

            // Bouton Close (croix)
            const closeBtn = createEl('button', {
                attrs: { 'data-testid': 'close-button', 'aria-label': 'Close' },
                className: `
          flex h-8 w-8 items-center justify-center
          rounded-full bg-transparent
          hover:bg-token-main-surface-secondary
          focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-token-text-quaternary focus-visible:ring-offset-1
          dark:hover:bg-token-main-surface-tertiary
        `,
                html: `
          <svg width="24" height="24" viewBox="0 0 24 24"
               fill="none" xmlns="http://www.w3.org/2000/svg"
               class="icon-md">
            <path fill-rule="evenodd" clip-rule="evenodd"
              d="M5.63603 5.63604C6.02656 5.24552 6.65972 5.24552 
                 7.05025 5.63604L12 10.5858L16.9497 5.63604C17.3403 
                 5.24552 17.9734 5.24552 18.364 5.63604C18.7545 
                 6.02657 18.7545 6.65973 18.364 7.05025L13.4142 
                 12L18.364 16.9497C18.7545 17.3403 18.7545 17.9734 
                 18.364 18.364C17.9734 18.7545 17.3403 18.7545 
                 16.9497 18.364L12 13.4142L7.05025 18.364C6.65972 
                 18.7545 6.02656 18.7545 5.63603 18.364C5.24551 
                 17.9734 5.24551 17.3403 5.63603 16.9497L10.5858 
                 12L5.63603 7.05025C5.24551 6.65973 5.24551 6.02657 
                 5.63603 5.63604Z"
              fill="currentColor"></path>
          </svg>
        `
            });
            closeBtn.addEventListener('click', () => {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 300);
                resolve(false);
            });
            header.appendChild(closeBtn);

            // === CONTENU PRINCIPAL SCROLLABLE ===
            const mainContainer = createEl('div', {
                className: `
          flex-grow
          overflow-y-auto
          relative
          text-sm text-token-text-primary
        `
            });

            // === FOOTER (facultatif) ===
            const footer = createEl('div', {
                className: `
          flex flex-col gap-3
          border-t border-black/10 dark:border-white/10
          px-4 py-4 sm:p-6
        `
            });
            // Pour l'instant, pas d'actions globales, on le laisse vide
            footer.style.display = 'none';

            // On assemble tout
            modal.appendChild(header);
            modal.appendChild(mainContainer);
            modal.appendChild(footer);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            // Animation d'apparition
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                modal.style.transform = 'scale(1)';
            });

            //------------------------------------------------
            //             LOGIQUE DU STEPPER
            //------------------------------------------------

            // Variables internes pour stocker les données entre étapes
            let githubTreeGlobal = null;
            let ownerGlobal = null;
            let repoGlobal = null;
            let branchGlobal = null;

            // Lance l'étape 1
            showStep1();

            /** Étape 1 : saisir l'URL du repo */
            function showStep1() {
                mainContainer.innerHTML = '';
                const contentWrap = createEl('div', {
                    className: 'px-4 pb-6 pt-4 sm:px-6'
                });

                const label = createEl('label', {
                    className: 'block text-sm font-semibold mb-2',
                    text: 'GitHub repo URL (ex: https://github.com/owner/repo[/tree/branch])'
                });

                const inputUrl = createEl('input', {
                    className: `
            w-full p-3 rounded-md
            border border-gray-300 dark:border-gray-600
            bg-token-main-surface-secondary
            text-token-text-primary
            placeholder-gray-500 dark:placeholder-gray-400
            focus:ring-2 focus:ring-green-500 focus:border-transparent
            transition-colors duration-200
          `,
                    attrs: {
                        type: 'text',
                        placeholder: 'https://github.com/owner/repo'
                    }
                });

                const loadBtn = createEl('button', {
                    className: `
            mt-4 px-4 py-2
            bg-green-600 hover:bg-green-700
            text-white font-medium text-sm
            rounded-md transition-colors duration-200
            focus:ring-2 focus:ring-green-500 focus:ring-offset-2
          `,
                    text: 'Load repository'
                });

                loadBtn.addEventListener('click', async () => {
                    const val = inputUrl.value.trim();
                    if (!val) return;

                    // On affiche un spinner pendant le chargement
                    mainContainer.innerHTML = '';
                    mainContainer.appendChild(spinnerSection('Loading repository data...'));

                    try {
                        const { owner, repo, branch } = parseGithubUrl(val);
                        if (!owner || !repo) {
                            mainContainer.innerHTML = '';
                            mainContainer.appendChild(errorSection('Invalid GitHub URL.'));
                            return;
                        }
                        const finalBranch = branch || await getDefaultBranch(owner, repo);
                        const tree = await fetchRepoTree(owner, repo, finalBranch);

                        // On stocke pour l'étape suivante
                        githubTreeGlobal = tree;
                        ownerGlobal = owner;
                        repoGlobal = repo;
                        branchGlobal = finalBranch;

                        // Étape 2
                        showStep2();
                    } catch (e) {
                        mainContainer.innerHTML = '';
                        mainContainer.appendChild(errorSection(e.message || 'Error while fetching repo.'));
                    }
                });

                contentWrap.append(label, inputUrl, loadBtn);
                mainContainer.appendChild(contentWrap);
            }

            /** Étape 2 : sélection des fichiers dans l'arborescence */
            function showStep2() {
                mainContainer.innerHTML = '';
                const wrapper = createEl('div', {
                    className: 'px-4 pb-6 pt-4 sm:px-6'
                });

                const note = createEl('p', {
                    className: 'mb-3 text-sm',
                    text: 'Select the files/folders to import:'
                });

                const treeContainer = createEl('div', {
                    className: `
            tree-view
            border border-gray-300 dark:border-gray-600
            rounded-md p-2
            max-h-[250px] overflow-auto
            bg-token-main-surface-secondary
          `
                });

                // Convertit githubTreeGlobal en un objet hiérarchique
                const treeData = {};
                githubTreeGlobal.forEach(item => {
                    if (!item || !item.path) return;
                    let current = treeData;
                    const parts = item.path.split('/');
                    parts.forEach((part, i) => {
                        if (!current[part]) {
                            current[part] = {
                                name: part,
                                path: parts.slice(0, i + 1).join('/'),
                                isFolder: (i < parts.length - 1) || (item.type === 'tree'),
                                children: {},
                                checked: true,
                                expanded: false
                            };
                        }
                        current = current[part].children;
                    });
                });

                // Rendu du tree
                renderTreeView(treeContainer, treeData);

                // Bouton confirm
                const confirmBtn = createEl('button', {
                    className: `
            mt-4 px-4 py-2
            bg-blue-600 hover:bg-blue-700
            text-white font-medium text-sm
            rounded-md transition-colors duration-200
            focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
          `,
                    text: 'Confirm'
                });

                confirmBtn.addEventListener('click', () => {
                    const selectedFiles = [];
                    function collectSelectedFiles(node) {
                        if (!node.isFolder && node.checked) selectedFiles.push(node.path);
                        Object.values(node.children).forEach(collectSelectedFiles);
                    }
                    Object.values(treeData).forEach(collectSelectedFiles);

                    if (!selectedFiles.length) {
                        alert('No files selected!');
                        return;
                    }
                    showStep3(selectedFiles);
                });

                wrapper.append(note, treeContainer, confirmBtn);
                mainContainer.appendChild(wrapper);
            }

            /** Étape 3 : import effectif des fichiers + message final */
            function showStep3(filePaths) {
                mainContainer.innerHTML = '';
                const info = createEl('div', {
                    className: `
            flex flex-col items-center justify-center gap-4
            p-6
          `
                });

                const title = createEl('div', {
                    className: 'text-lg font-medium',
                    text: 'Importing files...'
                });
                const progress = createEl('div', {
                    className: 'text-sm text-gray-500 dark:text-gray-400'
                });
                info.append(title, progress);
                mainContainer.appendChild(info);

                // Processus d'import
                (async () => {
                    let fetchCount = 0;
                    for (let i = 0; i < filePaths.length; i++) {
                        const path = filePaths[i];
                        progress.textContent = `(${i + 1}/${filePaths.length}) ${path}`;
                        try {
                            const raw = await fetchFileContentRaw(ownerGlobal, repoGlobal, branchGlobal, path);
                            uploadedFiles.push({
                                name: path,
                                content: raw,
                                modifyTime: new Date().toLocaleString(),
                                size: formatFileSize(raw.length)
                            });
                            fetchCount++;
                        } catch (err) {
                            console.error('Error fetching', path, err);
                        }
                    }

                    // On ajoute un attachment_info.xml avec la structure
                    const asciiTree = buildRepoStructureASCII(githubTreeGlobal);
                    const infoContent = [
                        '<attachment_info>',
                        `  Repository: https://github.com/${ownerGlobal}/${repoGlobal}`,
                        '',
                        `  Branch: ${branchGlobal}`,
                        '',
                        '  <structure>',
                        asciiTree,
                        '  </structure>',
                        '</attachment_info>'
                    ].join('\n');

                    uploadedFiles.push({
                        name: 'attachment_info.xml',
                        content: infoContent,
                        modifyTime: new Date().toLocaleString(),
                        size: formatFileSize(infoContent.length)
                    });

                    // Message de succès
                    info.innerHTML = `
            <div
              class="flex items-center justify-center w-16 h-16 
                     rounded-full bg-green-100 dark:bg-green-900/30">
              <svg class="w-8 h-8 text-green-500" fill="none"
                   stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            <div class="text-lg font-medium">Import Complete!</div>
            <div class="text-sm text-gray-500 dark:text-gray-400">
              Successfully imported ${fetchCount} file(s).
            </div>
          `;

                    // Ferme la modal au bout de 1.5s
                    setTimeout(() => {
                        overlay.style.opacity = '0';
                        setTimeout(() => overlay.remove(), 300);
                        resolve(true);
                    }, 1500);
                })();
            }

            //------------------------------------------------
            //      Petites fonctions pour spinner, erreur
            //------------------------------------------------

            function spinnerSection(label) {
                const container = createEl('div', {
                    className: 'p-6 flex items-center gap-3'
                });
                container.innerHTML = `
          <svg class="my-spinner" width="24" height="24" fill="none"
               stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
            <path d="M12 2 C6.48 2 2 6.48 2 12"
                  stroke-linecap="round" stroke-opacity="0.75"/>
          </svg>
          <span>${label || 'Loading...'}</span>
        `;
                return container;
            }

            function errorSection(message) {
                const div = createEl('div', {
                    className: 'p-6 text-red-600'
                });
                div.textContent = message;
                return div;
            }
        });
    }


    async function onClickGitHubImport() {
        closeMenuIfNeeded();
        const result = await showGitHubStepperModal();
        if (result) updatePreview();
    }

    function closeMenuIfNeeded() {
        const triggerBtn = document.querySelector('#radix-\\:rkd\\:');
        if (triggerBtn) {
            triggerBtn.click();
        } else {
            const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
            document.dispatchEvent(escEvent);
        }
    }

    //------------------------------------------------------------------
    // 7) Local file / folder upload
    //------------------------------------------------------------------
    function addLocalFileButton(menu) {
        if (menu.querySelector('.upload-texte-btn')) return;
        // Upload Files button
        const uploadFilesBtn = createEl('div', {
            className: `
                flex items-center m-1.5 p-2.5 text-sm cursor-pointer
                focus-visible:outline-0 group relative hover:bg-[#f5f5f5]
                dark:hover:bg-token-main-surface-secondary
                rounded-md gap-2.5 upload-texte-btn
            `,
            attrs: { role: 'menuitem', tabIndex: '-1' },
            html: `
                <div class="flex items-center justify-center text-token-text-secondary h-5 w-5">
                    <svg width="24" height="24" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 14.5V12a8 8 0 0 1 16 0v2.5"/>
                        <path d="M12 12v9"/>
                        <path d="M8 17l4-4 4 4"/>
                    </svg>
                </div>
                <div class="flex flex-col text-token-text-primary">Upload Files</div>
            `
        });
        const fileInput = createEl('input', { attrs: { type: 'file' }, style: 'display:none;' });
        fileInput.multiple = true;
        uploadFilesBtn.addEventListener('click', () => {
            closeMenuIfNeeded();
            fileInput.click();
        });
        fileInput.addEventListener('change', async () => {
            const arr = Array.from(fileInput.files || []);
            for (const f of arr) {
                const info = await readFileContent(f);
                uploadedFiles.push({ name: f.name, content: info.content, modifyTime: info.modifyTime, size: info.size });
            }
            updatePreview();
        });
        uploadFilesBtn.appendChild(fileInput);
        menu.appendChild(uploadFilesBtn);

        // Upload Folder
        const uploadFolderBtn = createEl('div', {
            className: `
                flex items-center m-1.5 p-2.5 text-sm cursor-pointer
                focus-visible:outline-0 group relative hover:bg-[#f5f5f5]
                dark:hover:bg-token-main-surface-secondary
                rounded-md gap-2.5
            `,
            attrs: { role: 'menuitem', tabIndex: '-1' },
            html: `
                <div class="flex items-center justify-center text-token-text-secondary h-5 w-5">
                    <svg width="24" height="24" viewBox="0 0 24 24"
                         fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 7H9L10 9H21V19C21 20.1046 20.1046 21
                                 19 21H5
                                 C3.8954 21 3 20.1046 3 19V7Z"/>
                        <path d="M3 7C3 5.89543 3.89543 5 5 5H8L9 7"/>
                    </svg>
                </div>
                <div class="flex flex-col text-token-text-primary">Upload Folder</div>
            `
        });
        const folderInput = createEl('input', { attrs: { type: 'file' }, style: 'display:none;' });
        folderInput.multiple = true;
        folderInput.setAttribute('webkitdirectory', '');
        folderInput.setAttribute('directory', '');
        uploadFolderBtn.addEventListener('click', () => {
            closeMenuIfNeeded();
            folderInput.click();
        });
        folderInput.addEventListener('change', async () => {
            const arr = Array.from(folderInput.files || []);
            if (!arr.length) return;

            // Construire la structure de données pour notre tree view
            const paths = arr.map(file => ({
                path: (file.webkitRelativePath || file.name).replace(/^\.?\//, ''),
                type: 'file'
            }));

            const chosen = await showFolderTreeModal(paths);
            if (!chosen) return;

            // Traiter les fichiers sélectionnés
            for (const p of chosen) {
                const fr = arr.find(f => (f.webkitRelativePath || f.name).replace(/^\.?\//, '') === p);
                if (fr) {
                    const info = await readFileContent(fr);
                    uploadedFiles.push({
                        name: p,
                        content: info.content,
                        modifyTime: info.modifyTime,
                        size: info.size
                    });
                }
            }
            updatePreview();
        });
        uploadFolderBtn.appendChild(folderInput);
        menu.appendChild(uploadFolderBtn);
    }

    //------------------------------------------------------------------
    // 8) Minimal folder-tree modal for local folder
    //------------------------------------------------------------------
    function showFolderTreeModal(paths) {
        return new Promise((resolve) => {
            let overlay = document.getElementById('folder-modal-overlay');
            if (overlay) overlay.remove();

            overlay = createEl('div', {
                attrs: { id: 'folder-modal-overlay' },
                className: `
                    fixed inset-0 bg-black bg-opacity-50 z-[9999]
                    flex items-center justify-center
                    opacity-0 transition-opacity duration-200
                `
            });

            const modal = createEl('div', {
                className: `
                    rounded-xl border border-token-border-light
                    bg-token-main-surface-primary text-token-text-primary p-4
                    w-[600px] max-w-[90vw] max-h-[80vh]
                    flex flex-col gap-4 transform scale-95
                    transition-transform duration-200
                `
            });

            // Header
            const header = createEl('div', {
                className: 'flex justify-between items-center'
            });
            const title = createEl('div', {
                className: 'font-semibold',
                text: 'Select files to import'
            });
            const buttonBox = createEl('div', {
                className: 'flex gap-2'
            });

            // Buttons
            const cancelBtn = createEl('button', {
                className: `
                    text-sm px-3 py-1 bg-token-main-surface-secondary
                    border border-token-border-light rounded
                    hover:bg-[#f0f0f0]
                `,
                text: 'Cancel'
            });

            const confirmBtn = createEl('button', {
                className: `
                    text-sm px-3 py-1 bg-token-main-surface-secondary
                    border border-token-border-light rounded
                    hover:bg-[#f0f0f0]
                `,
                text: 'Confirm'
            });

            buttonBox.append(cancelBtn, confirmBtn);
            header.append(title, buttonBox);

            // Tree container
            const treeContainer = createEl('div', {
                className: 'tree-view overflow-auto flex-1 border border-token-border-light p-3 rounded'
            });

            modal.append(header, treeContainer);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            // Animation
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
                modal.style.transform = 'scale(1)';
            });

            // Initialize tree (plus besoin de .map())
            const treeData = buildTreeData(paths);
            renderTreeView(treeContainer, treeData);

            // Events
            cancelBtn.onclick = () => {
                overlay.remove();
                resolve(null);
            };

            confirmBtn.onclick = () => {
                const selected = getSelectedFiles(treeData);
                overlay.remove();
                resolve(selected);
            };
        });
    }

    function buildTreeData(paths) {
        const tree = {};

        // Construire l'arbre
        paths.forEach(item => {
            if (!item || !item.path) return; // Skip invalid items

            let current = tree;
            const parts = item.path.split('/');

            parts.forEach((part, index) => {
                if (!current[part]) {
                    current[part] = {
                        name: part,
                        path: parts.slice(0, index + 1).join('/'),
                        isFolder: index < parts.length - 1,
                        children: {},
                        checked: false,
                        expanded: true
                    };
                }
                current = current[part].children;
            });
        });

        return tree;
    }

    function renderTreeView(container, treeData, level = 0, parentPath = '') {
        if (level === 0) {
            container.innerHTML = '';
        }

        Object.values(treeData).forEach(node => {
            const itemWrapper = document.createElement('div');
            itemWrapper.className = 'tree-node';

            // Créer l'élément principal
            const item = document.createElement('div');
            item.className = 'tree-item';
            item.style.paddingLeft = `${level * 24}px`;

            // Toggle pour les dossiers
            const toggle = document.createElement('div');
            toggle.className = `tree-toggle ${node.expanded ? 'expanded' : ''}`;
            if (node.isFolder) {
                toggle.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
            }

            // Icône
            const icon = document.createElement('div');
            icon.className = 'tree-icon';
            icon.innerHTML = node.isFolder ?
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h9l1 2h8v11a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>' :
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 00-2 2v16c0 1.1.9 2 2 2h12a2 2 0 002-2V9l-7-7z"/><path d="M13 2v7h7"/></svg>';

            // Checkbox
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'tree-checkbox';
            checkbox.checked = node.checked;

            // Label
            const label = document.createElement('div');
            label.className = 'tree-label';
            label.textContent = node.name;

            item.append(toggle, icon, checkbox, label);
            itemWrapper.appendChild(item);

            // Container pour les enfants avec animation
            if (node.isFolder) {
                const childrenContainer = document.createElement('div');
                childrenContainer.className = `tree-children ${node.expanded ? '' : 'collapsed'}`;

                // Render children
                renderTreeView(childrenContainer, node.children, level + 1, node.path);

                // Event listeners
                toggle.onclick = (e) => {
                    e.stopPropagation();
                    node.expanded = !node.expanded;
                    toggle.classList.toggle('expanded');

                    if (node.expanded) {
                        childrenContainer.classList.remove('collapsed');
                        // Set height for animation
                        const height = Array.from(childrenContainer.children)
                            .reduce((acc, child) => acc + child.offsetHeight, 0);
                        childrenContainer.style.height = height + 'px';
                    } else {
                        // Get current height
                        const height = childrenContainer.offsetHeight;
                        childrenContainer.style.height = height + 'px';
                        // Force reflow
                        childrenContainer.offsetHeight;
                        // Collapse
                        childrenContainer.classList.add('collapsed');
                    }
                };

                itemWrapper.appendChild(childrenContainer);
            }

            // Checkbox event
            checkbox.onchange = () => {
                node.checked = checkbox.checked;
                if (node.isFolder) {
                    updateChildrenChecked(node, checkbox.checked);
                    // Update children checkboxes in DOM
                    const childCheckboxes = itemWrapper.querySelectorAll('.tree-checkbox');
                    childCheckboxes.forEach(cb => {
                        cb.checked = checkbox.checked;
                    });
                }
                updateParentChecked(treeData, node.path);
            };

            container.appendChild(itemWrapper);
        });
    }

    function updateChildrenChecked(node, checked) {
        node.checked = checked;
        Object.values(node.children).forEach(child => {
            updateChildrenChecked(child, checked);
        });
    }

    function updateParentChecked(tree, path) {
        const parts = path.split('/');
        let current = tree;

        // Pour chaque niveau de profondeur sauf le dernier
        for (let i = 0; i < parts.length - 1; i++) {
            const parentPath = parts.slice(0, i + 1).join('/');
            const parent = getNodeByPath(tree, parentPath);

            if (!parent || !current[parts[i]]) continue;

            // Vérifier si tous les enfants sont cochés
            const children = Object.values(current[parts[i]].children);
            if (children.length > 0) {
                parent.checked = children.every(child => child.checked);
            }

            // Avancer dans l'arbre
            current = current[parts[i]].children;
        }
    }

    function getNodeByPath(tree, path) {
        let current = tree;
        const parts = path.split('/');

        for (const part of parts) {
            if (!current[part]) return null;
            current = current[part];
        }

        return current;
    }

    function getSelectedFiles(tree) {
        const selected = [];

        function traverse(node) {
            if (!node.isFolder && node.checked) {
                selected.push(node.path);
            }
            Object.values(node.children).forEach(traverse);
        }

        Object.values(tree).forEach(traverse);
        return selected;
    }

    //------------------------------------------------------------------
    // 9) Add "Upload from GitHub" button + hooking
    //------------------------------------------------------------------
    function addGithubButton(menu) {
        if (menu.querySelector('.upload-github-btn')) return;

        const ghBtn = createEl('div', {
            className: `
                flex items-center m-1.5 p-2.5 text-sm cursor-pointer
                focus-visible:outline-0 group relative hover:bg-[#f5f5f5]
                dark:hover:bg-token-main-surface-secondary
                rounded-md gap-2.5 upload-github-btn
            `,
            attrs: { role: 'menuitem', tabIndex: '-1' },
            children: [
                createEl('div', {
                    className: 'flex items-center justify-center text-token-text-secondary h-5 w-5', html: `
                    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" width="16" height="16">
                        <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.61-.25-1.22-.58-1.69 1.64-.17 3.41-.81 3.41-3.63 0-.81-.28-1.48-.78-2.02.08-.17.35-.91-.07-1.98 0 0-.63-.2-2.09.79-.6-.17-1.24-.26-1.88-.26-.64 0-1.28.09-1.88.26-1.46-1-2.09-.79-2.09-.79-.42 1.07-.15 1.81-.07 1.98-.5 1.01-.78 1.64-.78 2.45 0 2.82 1.77 3.46 3.41 3.63-.3 1.01-.58 1.91-.58 2.9 0 .21-.02.3-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
                    </svg>
                `}),
                createEl('div', {
                    className: 'flex flex-col text-token-text-primary dark:text-token-text-primary',
                    text: 'Upload from GitHub'
                })
            ]
        });
        ghBtn.addEventListener('click', onClickGitHubImport);
        menu.appendChild(ghBtn);
    }

    // The function that tries to add our 3 new buttons into the ChatGPT menu
    function addUploadButtons() {
        const menu = document.querySelector('div[role="menu"]');
        if (!menu) return;
        addLocalFileButton(menu);
        addGithubButton(menu);
    }

    //------------------------------------------------------------------
    // 10) Observers / main entry
    //------------------------------------------------------------------
    function observeMenuAndSend() {
        const obs = new MutationObserver(() => {
            addUploadButtons();
            interceptSend();
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
    }

    //------------------------------------------------------------------
    // MAIN
    //------------------------------------------------------------------
    observeMenuAndSend();
    observeUserMessages();
})();
