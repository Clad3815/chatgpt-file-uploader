// ==UserScript==
// @name         Real ChatGPT File Uploader
// @namespace    http://tampermonkey.net/
// @version      3.0.1
// @description  Adds true file upload capabilities to ChatGPT with preview, syntax highlighting, and proper file handling - features not available in the standard interface.
// @match        https://chatgpt.com/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-python.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-javascript.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-markup.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-css.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-json.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-markdown.min.js
// @resource     PRISM_CSS https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css
// ==/UserScript==

(function() {
    'use strict';

    // Inject Prism CSS
    const style = document.createElement('style');
    style.textContent = `
        /* Base styles for code blocks */
        code[class*="language-"],
        pre[class*="language-"] {
            font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
            font-size: 1em;
            text-align: left;
            white-space: pre;
            word-spacing: normal;
            word-break: normal;
            word-wrap: normal;
            line-height: 1.5;
            tab-size: 4;
            hyphens: none;
            border-radius: 6px;
        }

        /* Light theme */
        code[class*="language-"],
        pre[class*="language-"] {
            color: #24292e;
            background: #f6f8fa;
        }

        /* Dark theme */
        .dark code[class*="language-"],
        .dark pre[class*="language-"] {
            color: #e1e4e8;
            background: #1f2428;
        }

        /* Token colors - Light theme */
        .token.comment,
        .token.prolog,
        .token.doctype,
        .token.cdata {
            color: #6a737d;
        }

        .token.punctuation {
            color: #24292e;
        }

        .token.property,
        .token.tag,
        .token.boolean,
        .token.number,
        .token.constant,
        .token.symbol {
            color: #005cc5;
        }

        .token.selector,
        .token.attr-name,
        .token.string,
        .token.char,
        .token.builtin {
            color: #032f62;
        }

        .token.operator,
        .token.entity,
        .token.url,
        .language-css .token.string,
        .token.variable,
        .token.inserted {
            color: #22863a;
        }

        .token.atrule,
        .token.attr-value,
        .token.keyword {
            color: #d73a49;
        }

        .token.function {
            color: #6f42c1;
        }

        .token.class-name {
            color: #6f42c1;
        }

        .token.regex,
        .token.important {
            color: #e36209;
        }

        /* Token colors - Dark theme */
        .dark .token.comment,
        .dark .token.prolog,
        .dark .token.doctype,
        .dark .token.cdata {
            color: #8b949e;
        }

        .dark .token.punctuation {
            color: #e1e4e8;
        }

        .dark .token.property,
        .dark .token.tag,
        .dark .token.boolean,
        .dark .token.number,
        .dark .token.constant,
        .dark .token.symbol {
            color: #79c0ff;
        }

        .dark .token.selector,
        .dark .token.attr-name,
        .dark .token.string,
        .dark .token.char,
        .dark .token.builtin {
            color: #a5d6ff;
        }

        .dark .token.operator,
        .dark .token.entity,
        .dark .token.url,
        .dark .language-css .token.string,
        .dark .token.variable,
        .dark .token.inserted {
            color: #7ee787;
        }

        .dark .token.atrule,
        .dark .token.attr-value,
        .dark .token.keyword {
            color: #ff7b72;
        }

        .dark .token.function {
            color: #d2a8ff;
        }

        .dark .token.class-name {
            color: #d2a8ff;
        }

        .dark .token.regex,
        .dark .token.important {
            color: #ffa657;
        }

        /* Additional styles */
        pre[class*="language-"] {
            padding: 1em;
            margin: 0.5em 0;
            overflow: auto;
        }

        /* Inline code */
        :not(pre) > code[class*="language-"] {
            padding: 0.1em 0.3em;
            border-radius: 0.3em;
            white-space: normal;
        }
    `;
    document.head.appendChild(style);

    let uploadedFiles = [];
    const processedMessages = {};

    function createEl(tag, { className = '', text = '', html = '', attrs = {}, children = [] } = {}) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text) el.textContent = text;
        if (html) el.innerHTML = html;
        for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, v);
        for (const c of children) el.appendChild(c);
        return el;
    }

    function showModal(fileName, fileContent, fileInfo) {
        let overlay = document.querySelector('#files-modal-overlay');
        if (overlay) overlay.remove();

        overlay = createEl('div', {
            attrs: { 'id': 'files-modal-overlay' },
            className: `fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center opacity-0 transition-opacity duration-200`
        });

        const modal = createEl('div', {
            className: `rounded-xl border border-token-border-light dark:border-token-border-dark bg-token-main-surface-primary dark:bg-token-main-surface-secondary text-token-text-primary p-4 max-w-[80vw] max-h-[80vh] flex flex-col gap-4 transform scale-95 transition-transform duration-200`
        });

        const header = createEl('div', { className: "flex justify-between items-center" });
        const titleContainer = createEl('div', { className: "flex-1" });
        const title = createEl('div', { className: "font-semibold text-token-text-primary dark:text-token-text-primary", text: fileName });
        const fileDetails = createEl('div', {
            className: "text-xs text-token-text-secondary mt-1",
            text: formatFileDetails(fileInfo)
        });

        const buttonsContainer = createEl('div', { className: "flex gap-2 ml-4" });

        // Download button
        const downloadBtn = createEl('button', {
            className: `text-sm px-3 py-1 bg-token-main-surface-secondary dark:bg-token-main-surface-primary border border-token-border-light dark:border-token-border-dark rounded hover:bg-[#f0f0f0] dark:hover:bg-token-main-surface-secondary cursor-pointer flex items-center gap-2`,
            html: `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>Download</span>
            `
        });

        downloadBtn.addEventListener('click', () => {
            const blob = new Blob([fileContent], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            window.URL.revokeObjectURL(url);
        });

        const closeBtn = createEl('button', {
            className: `text-sm px-3 py-1 bg-token-main-surface-secondary dark:bg-token-main-surface-primary border border-token-border-light dark:border-token-border-dark rounded hover:bg-[#f0f0f0] dark:hover:bg-token-main-surface-secondary cursor-pointer`,
            text: 'Close'
        });

        closeBtn.addEventListener('click', () => overlay.remove());

        titleContainer.appendChild(title);
        titleContainer.appendChild(fileDetails);
        buttonsContainer.appendChild(downloadBtn);
        buttonsContainer.appendChild(closeBtn);
        header.appendChild(titleContainer);
        header.appendChild(buttonsContainer);

        const fileExtension = fileName.split('.').pop().toLowerCase();
        const language = getLanguageFromExtension(fileExtension);

        const contentBlock = createEl('pre', {
            className: `whitespace-pre-wrap break-words text-token-text-primary dark:text-token-text-primary bg-token-main-surface-secondary dark:bg-token-main-surface-secondary p-2 rounded border border-token-border-light dark:border-token-border-dark overflow-auto flex-1 ${language ? 'language-' + language : ''}`,
            style: 'max-width: 60vw; word-wrap: break-word;'
        });

        if (language) {
            contentBlock.innerHTML = Prism.highlight(fileContent, Prism.languages[language], language);
        } else {
            contentBlock.textContent = fileContent;
        }

        // Animation entry
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            modal.style.transform = 'scale(1)';
        });

        modal.appendChild(header);
        modal.appendChild(contentBlock);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    function getLanguageFromExtension(ext) {
        const languageMap = {
            'js': 'javascript',
            'py': 'python',
            'html': 'html',
            'css': 'css',
            'json': 'json',
            'md': 'markdown',
            // Add other extensions as needed
        };
        return languageMap[ext] || null;
    }

    function removeFile(fileIndex) {
        uploadedFiles.splice(fileIndex, 1);
        updatePreview();
    }

    function updatePreview() {
        let previewContainer = document.querySelector('#files-preview');
        const textarea = document.querySelector('#prompt-textarea');
        if (!textarea) return;

        if (!previewContainer) {
            const textareaParent = textarea.closest('.relative.flex');
            if (!textareaParent) return;

            previewContainer = document.createElement('div');
            previewContainer.id = 'files-preview';
            previewContainer.className = "mt-3 p-4 rounded-xl border border-token-border-light dark:border-token-border-dark bg-token-main-surface-primary dark:bg-token-main-surface-secondary text-token-text-primary";
            textareaParent.parentNode.insertBefore(previewContainer, textareaParent.nextSibling);
        }

        // Clean up old blocks
        previewContainer.innerHTML = '';

        if (uploadedFiles.length === 0) {
            previewContainer.remove();
            return;
        }

        // Add a header for the container
        const headerContainer = createEl('div', {
            className: 'flex items-center justify-between mb-3 pb-2 border-b border-token-border-light dark:border-token-border-dark'
        });

        const headerTitle = createEl('div', {
            className: 'text-sm font-medium flex items-center gap-2',
            html: `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                    <polyline points="13 2 13 9 20 9"/>
                </svg>
                Files attached (${uploadedFiles.length})
            `
        });

        headerContainer.appendChild(headerTitle);
        previewContainer.appendChild(headerContainer);

        // Container for files grid
        const filesGrid = createEl('div', {
            className: 'grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
        });

        // Display files
        uploadedFiles.forEach((fileObj, index) => {
            const fileBlock = createEl('div', {
                className: "file-block relative bg-token-main-surface-secondary dark:bg-token-main-surface-primary rounded-lg p-3 hover:bg-opacity-70 transition-all duration-200 group"
            });

            const fileContent = createEl('div', {
                className: 'flex items-start gap-3'
            });

            // File icon
            const fileIcon = createEl('div', {
                className: 'flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg bg-token-main-surface-primary dark:bg-token-main-surface-secondary',
                html: `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-token-text-secondary">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                        <polyline points="13 2 13 9 20 9"/>
                    </svg>
                `
            });

            // File information
            const fileInfo = createEl('div', {
                className: 'flex-1 min-w-0'
            });

            const fileName = createEl('div', {
                className: 'font-medium text-sm truncate text-token-text-primary',
                text: fileObj.name
            });

            const fileDetails = createEl('div', {
                className: 'text-xs text-token-text-secondary mt-0.5',
                text: fileObj.size
            });

            // Actions
            const actions = createEl('div', {
                className: 'absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200'
            });

            // View button
            const viewBtn = createEl('button', {
                className: 'p-1.5 rounded-md hover:bg-token-main-surface-primary dark:hover:bg-token-main-surface-secondary text-token-text-secondary hover:text-token-text-primary transition-colors duration-200',
                html: `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                `,
                attrs: { 'title': 'View content' }
            });

            // Delete button
            const deleteBtn = createEl('button', {
                className: 'p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-token-text-secondary hover:text-red-500 transition-colors duration-200',
                html: `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                `,
                attrs: { 'title': 'Delete' }
            });

            viewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showModal(fileObj.name, fileObj.content, fileObj);
            });

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeFile(index);
            });

            actions.appendChild(viewBtn);
            actions.appendChild(deleteBtn);

            fileInfo.appendChild(fileName);
            fileInfo.appendChild(fileDetails);
            fileContent.appendChild(fileIcon);
            fileContent.appendChild(fileInfo);
            fileBlock.appendChild(fileContent);
            fileBlock.appendChild(actions);
            filesGrid.appendChild(fileBlock);

            // Click on block to view content
            fileBlock.addEventListener('click', () => {
                showModal(fileObj.name, fileObj.content, fileObj);
            });
        });

        previewContainer.appendChild(filesGrid);
    }

    async function insertFilesIntoTextarea() {
        const textarea = document.querySelector('#prompt-textarea');
        if (!textarea || uploadedFiles.length === 0) return;

        let filesXML = "\n<user_attachments>";
        for (const f of uploadedFiles) {
            filesXML += `\n  <attachment name="${f.name}" last_edit="${f.modifyTime}" size="${f.size}">\n${f.content}\n  </attachment>`;
        }
        filesXML += "\n</user_attachments>\n\n";

        const currentText = textarea.innerText;
        textarea.innerHTML = "";
        const p = document.createElement('p');
        p.appendChild(document.createTextNode(filesXML + currentText));
        textarea.appendChild(p);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));

        uploadedFiles = [];
        updatePreview();
    }

    function interceptSend() {
        const sendBtn = document.querySelector('button[data-testid="send-button"]');
        if (!sendBtn) return;

        if (!sendBtn.dataset.tampermonkeyInjected) {
            sendBtn.dataset.tampermonkeyInjected = "true";
            sendBtn.addEventListener('click', async () => {
                if (uploadedFiles.length > 0) {
                    await insertFilesIntoTextarea();
                }
            }, {capture:true});
        }

        const textarea = document.querySelector('#prompt-textarea');
        if (textarea && !textarea.dataset.tampermonkeyEnterHooked) {
            textarea.dataset.tampermonkeyEnterHooked = "true";
            textarea.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    if (uploadedFiles.length > 0) {
                        await insertFilesIntoTextarea();
                    }
                }
            }, {capture:true});
        }
    }

    function addUploadTextButton() {
        const menu = document.querySelector('div[role="menu"]');
        if (!menu) return;

        if (menu.querySelector('.upload-texte-btn')) return;

        const newItem = document.createElement('div');
        newItem.setAttribute('role', 'menuitem');
        newItem.setAttribute('data-orientation', 'vertical');
        newItem.setAttribute('data-radix-collection-item', '');
        newItem.tabIndex = -1;

        newItem.className = "flex items-center m-1.5 p-2.5 text-sm cursor-pointer focus-visible:outline-0 radix-disabled:pointer-events-none radix-disabled:opacity-50 group relative hover:bg-[#f5f5f5] focus-visible:bg-[#f5f5f5] dark:hover:bg-token-main-surface-secondary dark:focus-visible:bg-token-main-surface-secondary rounded-md my-0 px-3 mx-2 dark:radix-state-open:bg-token-main-surface-secondary gap-2.5 py-3 upload-texte-btn";
        newItem.innerHTML = `
            <div class="flex items-center justify-center text-token-text-secondary h-5 w-5">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 14.5V12a8 8 0 0 1 16 0v2.5"/>
                    <path d="M12 12v9"/>
                    <path d="M8 17l4-4 4 4"/>
                </svg>
            </div>
            <div class="flex flex-col text-token-text-primary dark:text-token-text-primary">Upload Files (Custom)</div>
        `;

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.style.display = 'none';
        fileInput.multiple = true;

        newItem.addEventListener('click', () => {

            const triggerBtn = document.querySelector('#radix-\\:rkd\\:');
            if (triggerBtn) {
                triggerBtn.click();
            } else {
                const escEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27 });
                document.dispatchEvent(escEvent);
            }
            fileInput.click();
        });

        fileInput.addEventListener('change', () => {
            const files = Array.from(fileInput.files);
            if (files.length === 0) return;

            (async () => {
                for (const file of files) {
                    const fileInfo = await readFileContent(file);
                    uploadedFiles.push({
                        name: file.name,
                        content: fileInfo.content,
                        modifyTime: fileInfo.modifyTime,
                        size: fileInfo.size
                    });
                }

                updatePreview();
            })();
        });

        menu.appendChild(newItem);
        menu.appendChild(fileInput);
    }

    function readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const modifyTime = new Date(file.lastModified).toLocaleString();
                const size = formatFileSize(file.size);
                resolve({
                    content: e.target.result,
                    modifyTime,
                    size
                });
            };
            reader.onerror = (err) => reject(err);
            reader.readAsText(file);
        });
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function processUserMessage(messageEl) {
        const messageId = messageEl.getAttribute('data-message-id');
        if (!messageId) return;

        const msgTextEl = messageEl.querySelector('.whitespace-pre-wrap');
        if (!msgTextEl) return;

        let originalText = msgTextEl.textContent;
        if (processedMessages[messageId] && processedMessages[messageId].originalText === originalText) {
            return;
        }

        // New regex pattern for the updated structure
        const attachmentsRegex = /<user_attachments>([\s\S]*?)<\/user_attachments>/g;
        const attachmentRegex = /<attachment name="([^"]+)" last_edit="([^"]+)" size="([^"]+)">\s*([\s\S]*?)\s*<\/attachment>/g;
        
        const files = [];
        let newText = originalText;
        let attachmentsMatch;

        while ((attachmentsMatch = attachmentsRegex.exec(originalText)) !== null) {
            const attachmentsContent = attachmentsMatch[1];
            let attachmentMatch;
            
            while ((attachmentMatch = attachmentRegex.exec(attachmentsContent)) !== null) {
                const fileName = attachmentMatch[1];
                const modifyTime = attachmentMatch[2];
                const size = attachmentMatch[3];
                const fileContent = attachmentMatch[4];
                
                files.push({
                    name: fileName,
                    content: fileContent,
                    modifyTime,
                    size
                });
            }
            
            // Remove the entire attachments block from text
            newText = newText.replace(attachmentsMatch[0], '');
        }

        // Rest of the function remains the same
        if (files.length === 0) {
            processedMessages[messageId] = { originalText, filesFound: [] };
            return;
        }

        // Put cleaned text in msgTextEl
        msgTextEl.textContent = newText.trim();

        // If we have files, insert them in a separate container
        if (files.length > 0) {
            let existingFilesContainer = messageEl.querySelector('.parsed-files-container');
            if (existingFilesContainer) {
                existingFilesContainer.remove();
            }

            const filesContainer = createEl('div', {
                className: 'parsed-files-container mt-3 mb-4'
            });

            // Add a title for the files section
            const filesHeader = createEl('div', {
                className: 'text-xs text-token-text-secondary mb-2 font-medium',
                text: `Files shared (${files.length})`
            });
            filesContainer.appendChild(filesHeader);

            const filesWrapper = createEl('div', {
                className: 'flex flex-col gap-2'
            });

            files.forEach((f) => {
                const fileBlock = createEl('div', {
                    className: "group relative flex items-center gap-3 rounded-xl border border-token-border-light dark:border-token-border-dark bg-token-main-surface-secondary p-3 hover:bg-token-main-surface-tertiary transition-colors duration-200"
                });

                const iconWrapper = createEl('div', {
                    className: 'flex items-center justify-center w-8 h-8 rounded-lg bg-token-main-surface-primary text-token-text-secondary'
                });
                iconWrapper.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M13 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V9L13 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M13 2V9H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                `;

                const fileInfo = createEl('div', {
                    className: 'flex-1'
                });

                const fileName = createEl('div', {
                    className: 'text-sm font-medium text-token-text-primary',
                    text: f.name
                });

                const fileDetails = createEl('div', {
                    className: 'text-xs text-token-text-secondary mt-1',
                    text: formatFileDetails(f)
                });

                const viewBtn = createEl('button', {
                    className: 'absolute right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-xs py-1 px-3 rounded-md bg-token-main-surface-primary hover:bg-token-main-surface-tertiary text-token-text-primary border border-token-border-light',
                    text: 'View content'
                });

                viewBtn.addEventListener('click', () => showModal(f.name, f.content, f));

                fileInfo.appendChild(fileName);
                fileInfo.appendChild(fileDetails);
                fileBlock.appendChild(iconWrapper);
                fileBlock.appendChild(fileInfo);
                fileBlock.appendChild(viewBtn);
                filesWrapper.appendChild(fileBlock);
            });

            filesContainer.appendChild(filesWrapper);
            msgTextEl.parentElement.insertBefore(filesContainer, msgTextEl);
        }

        processedMessages[messageId] = {
            originalText,
            filesFound: files
        };
    }

    function handleMutations() {
        const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
        userMessages.forEach((m) => processUserMessage(m));
    }

    function observeUserMessages() {
        const chatContainer = document.body;
        const userMessageObserver = new MutationObserver((mutations) => {
            handleMutations();
        });
        userMessageObserver.observe(chatContainer, { childList: true, subtree: true });

        handleMutations();
    }

    const globalObserver = new MutationObserver(() => {
        addUploadTextButton();
        interceptSend();
    });
    globalObserver.observe(document.documentElement, { childList: true, subtree: true });

    observeUserMessages();

    // New utility function to format file details
    function formatFileDetails(fileInfo) {
        const parts = [];
        if (fileInfo.modifyTime) parts.push(`Modified on ${fileInfo.modifyTime}`);
        if (fileInfo.size) parts.push(fileInfo.size);
        return parts.join(' • ');
    }


})();
