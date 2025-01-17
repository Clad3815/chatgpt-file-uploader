# Real ChatGPT File Uploader

A powerful Tampermonkey userscript that adds true file upload capabilities to ChatGPT, enabling seamless file sharing and management within your conversations. Now with support for folder uploads and GitHub repository imports.

<div align="center">
  <img src="images/1.png" alt="ChatGPT File Upload Interface" style="max-width: 80%; height: auto;">
</div>

After getting frustrated with constantly copy-pasting code into ChatGPT to work with o1-pro, I built something that I think you'll find useful.

## 🌟 Why This Tool?

While ChatGPT's interface has evolved, it still lacks native file upload support for many models (e.g., o1-mini, o1, o1-pro). 
For GPT-4o users who have native file upload, this plugin provides a superior alternative by sending the complete file content directly in the conversation, bypassing ChatGPT's RAG-based file processing. This userscript provides:

- True file upload functionality (not just copy/paste)
- Direct file content transmission (no RAG processing for GPT-4o)
- Proper file parsing that ChatGPT understands
- Clean UI integration with the ChatGPT interface
- Syntax highlighting for code files
- Dark/Light theme support
- **New**: Upload entire folders
- **New**: Import files directly from GitHub repositories

<div align="center">
  <img src="images/2.png" alt="File Preview and Management" style="max-width: 80%; height: auto;">
</div>

## ✨ Key Features

- 📤 **Direct File Upload**: Upload files directly through ChatGPT's interface
- 📁 **Folder Upload**: Upload entire folders and manage their contents
- 🌐 **GitHub Integration**: Import files from GitHub repositories using a stepper-based flow
- 👀 **Smart Preview**: Preview files before sending, with syntax highlighting for code
- 🎨 **Syntax Highlighting**: Automatic language detection and highlighting for common file types
- 📝 **Message Integration**: Files appear neatly above your messages
- 🔍 **Content Viewer**: Modal viewer with download capability
- 🗑️ **File Management**: Easy file removal and management
- 🌓 **Theme Support**: Seamless integration with ChatGPT's light/dark themes
- 🔒 **Local Processing**: All file handling happens in your browser

<div align="center">
  <img src="images/3.png" alt="File Content Viewer" style="max-width: 80%; height: auto;">
</div>

## 📥 Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension for your browser
2. Click this [installation link](https://raw.githubusercontent.com/clad3815/chatgpt-file-uploader/main/src/chatgpt-upload-files-plugin.user.js)
3. Confirm the installation in Tampermonkey

## 🚀 How to Use

1. Open ChatGPT
2. Click the paper clip button next to the text input
3. Select "Upload Files" or "Upload Folder" or "Upload from GitHub"
4. Choose one or more files or folders
5. Preview and manage your files
6. Send your message as usual

## 🛠️ Technical Details

### Model Compatibility
- **O1 Models**: Adds file upload capability for o1-mini, o1, and o1-pro
- **GPT-4o**: Provides direct file content transmission, bypassing the default RAG-based file processing

### Supported File Types
- Code files (`.js`, `.py`, `.html`, `.css`, `.json`, etc.)
- Text files (`.txt`, `.md`)
- And more...

### File Format
Files are automatically formatted in XML for optimal ChatGPT processing:

```xml
<user_attachments>
  <attachment name="example.js" last_edit="2024-03-20 15:30:00" size="1.2 KB">
    console.log("Hello, World!");
  </attachment>
</user_attachments>
```

### GitHub Integration
- Import files from any public GitHub repository
- Use a stepper-based flow to select files and folders


<div align="center">
  <img src="images/4.png" alt="Github Stepper 1" style="max-width: 80%; height: auto;">
</div>


<div align="center">
  <img src="images/5.png" alt="Github Stepper 2" style="max-width: 80%; height: auto;">
</div>

## 💡 Tips & Tricks

- Upload multiple files or entire folders at once for batch processing
- Use the preview feature to verify file contents
- Files can be downloaded from the preview modal
- Remove files easily before sending if needed
- Use the GitHub import feature to quickly bring in code from repositories

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

## 📜 License

MIT License - feel free to use and modify as needed.

## 🙏 Acknowledgments

- [ChatGPT](https://chat.openai.com) for the platform
- [Tampermonkey](https://www.tampermonkey.net/) for making userscripts possible
- [Prism.js](https://prismjs.com/) for syntax highlighting

---

<div align="center">
Made with ❤️ for the ChatGPT community
</div>