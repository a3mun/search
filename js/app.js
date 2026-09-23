/* ============================================================
   Search of Sky — App Logic (UI)
   v2.2 — پنل مدیریت فایل‌ها + انتخاب همه + حذف تکی
   ============================================================ */

(function() {
    'use strict';
    
    const state = {
        files: [],                    // فایل‌های فعال (فیلترشده)
        allFiles: [],                 // همه‌ی فایل‌های لود‌شده
        selectedFileNames: new Set(), // نام فایل‌های انتخاب‌شده
        sourceName: "",
        sourceType: "",               // "folder" | "files" | ""
        results: [],
        isSearching: false,
        theme: "dark",
        lastQuery: "",
        worker: null,
        deferredPrompt: null,
        filePanelOpen: false,
    };
    
    const $ = (id) => document.getElementById(id);
    
    const el = {
        splashScreen: $("splashScreen"),
        themeBtn: $("themeBtn"),
        installBtn: $("installBtn"),
        helpBtn: $("helpBtn"),
        searchBtn: $("searchBtn"),
        cancelBtn: $("cancelBtn"),
        clearBtn: $("clearBtn"),
        folderBtn: $("folderBtn"),
        filesBtn: $("filesBtn"),
        searchInput: $("searchInput"),
        clearInputBtn: $("clearInputBtn"),
        wholeWordCheck: $("wholeWordCheck"),
        maxResults: $("maxResults"),
        
        // Source info
        sourceInfoBtn: $("sourceInfoBtn"),
        sourceIcon: $("sourceIcon"),
        sourceText: $("sourceText"),
        sourceBadge: $("sourceBadge"),
        sourceArrow: $("sourceArrow"),
        
        // File panel
        filePanel: $("filePanel"),
        selectAllCheck: $("selectAllCheck"),
        filePanelCount: $("filePanelCount"),
        clearFilesBtn: $("clearFilesBtn"),
        fileSearchInput: $("fileSearchInput"),
        clearFileSearchBtn: $("clearFileSearchBtn"),
        fileList: $("fileList"),
        
        folderInput: $("folderInput"),
        filesInput: $("filesInput"),
        
        progressSection: $("progressSection"),
        progressText: $("progressText"),
        progressPercent: $("progressPercent"),
        progressFill: $("progressFill"),
        resultsCount: $("resultsCount"),
        timeBadge: $("timeBadge"),
        copyAllBtn: $("copyAllBtn"),
        resultsList: $("resultsList"),
        emptyState: $("emptyState"),
        statusBar: $("statusBar"),
        viewModal: $("viewModal"),
        modalTitle: $("modalTitle"),
        modalSummary: $("modalSummary"),
        modalText: $("modalText"),
        modalCloseBtn: $("modalCloseBtn"),
        modalCloseBtn2: $("modalCloseBtn2"),
        modalCopyBtn: $("modalCopyBtn"),
        modalShareBtn: $("modalShareBtn"),
        welcomeModal: $("welcomeModal"),
        welcomeCloseBtn: $("welcomeCloseBtn"),
        welcomeCloseBtn2: $("welcomeCloseBtn2"),
        welcomeStartBtn: $("welcomeStartBtn"),
        toast: $("toast"),
    };
    
    // ═══════════════════════════════════════════════════════
    //  Helpers
    // ═══════════════════════════════════════════════════════
    
    function escapeHtml(text) {
        if (!text) return "";
        return text
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
    
    function haptic(pattern) {
        if (navigator.vibrate) {
            try { navigator.vibrate(pattern || 10); } catch (e) {}
        }
    }
    
    function isReadableFile(file) {
        const name = (file.name || "").toLowerCase();
        for (const ext of SS_CORE.FAST_EXTENSIONS) {
            if (name.endsWith(ext)) return true;
        }
        return false;
    }
    
    // ═══════════════════════════════════════════════════════
    //  Splash
    // ═══════════════════════════════════════════════════════
    
    function hideSplash() {
        setTimeout(() => {
            if (el.splashScreen) {
                el.splashScreen.classList.add("hidden");
                setTimeout(() => el.splashScreen.remove(), 500);
            }
        }, 1200);
    }
    
    // ═══════════════════════════════════════════════════════
    //  Theme
    // ═══════════════════════════════════════════════════════
    
    function loadTheme() {
        let saved = "dark";
        try { saved = localStorage.getItem("ss-theme") || "dark"; } catch (e) {}
        state.theme = saved;
        applyTheme();
    }
    
    function applyTheme() {
        if (state.theme === "light") {
            document.body.classList.add("light");
            el.themeBtn.textContent = "☀️";
        } else {
            document.body.classList.remove("light");
            el.themeBtn.textContent = "🌙";
        }
    }
    
    function toggleTheme() {
        haptic(15);
        state.theme = state.theme === "dark" ? "light" : "dark";
        try { localStorage.setItem("ss-theme", state.theme); } catch (e) {}
        applyTheme();
    }
    
    // ═══════════════════════════════════════════════════════
    //  Toast
    // ═══════════════════════════════════════════════════════
    
    let toastTimer = null;
    
    function showToast(message, kind) {
        kind = kind || "info";
        clearTimeout(toastTimer);
        el.toast.textContent = message;
        el.toast.className = "toast";
        if (kind === "error") el.toast.classList.add("error");
        else if (kind === "warning") el.toast.classList.add("warning");
        void el.toast.offsetWidth;
        el.toast.classList.add("active");
        toastTimer = setTimeout(() => el.toast.classList.remove("active"), 2200);
    }
    
    // ═══════════════════════════════════════════════════════
    //  Welcome
    // ═══════════════════════════════════════════════════════
    
    function showWelcome() { el.welcomeModal.classList.add("active"); }
    function closeWelcome() {
        el.welcomeModal.classList.remove("active");
        try { localStorage.setItem("ss-visited", "1"); } catch (e) {}
    }
    function checkFirstVisit() {
        let visited = false;
        try { visited = localStorage.getItem("ss-visited") === "1"; } catch (e) {}
        if (!visited) setTimeout(showWelcome, 1500);
    }
    
    // ═══════════════════════════════════════════════════════
    //  Source Selection — Folder
    // ═══════════════════════════════════════════════════════
    
    function chooseFolder() {
        haptic(10);
        el.folderInput.click();
    }
    
    function onFolderSelected(event) {
        const allFiles = Array.from(event.target.files || []);
        if (!allFiles.length) return;
        
        const readable = allFiles.filter(isReadableFile);
        
        if (readable.length === 0) {
            showToast("هیچ فایل قابل جستجویی پیدا نشد", "warning");
            haptic([20, 50, 20]);
            setTimeout(() => { el.folderInput.value = ""; }, 100);
            return;
        }
        
        state.allFiles = readable;
        state.files = readable.slice();
        state.selectedFileNames = new Set(readable.map(f => f.name));
        state.sourceType = "folder";
        
        if (allFiles[0].webkitRelativePath) {
            const parts = allFiles[0].webkitRelativePath.split("/");
            state.sourceName = parts.slice(0, -1).join("/") || parts[0];
        } else {
            state.sourceName = "(پوشه)";
        }
        
        updateSourceUI();
        haptic([10, 30, 10]);
        showToast(`${readable.length} فایل بارگذاری شد`, "success");
        
        setTimeout(() => { el.folderInput.value = ""; }, 100);
        clearResults();
    }
    
    // ═══════════════════════════════════════════════════════
    //  Source Selection — Files
    // ═══════════════════════════════════════════════════════
    
    function chooseFiles() {
        haptic(10);
        el.filesInput.click();
    }
    
    function onFilesSelected(event) {
        const allFiles = Array.from(event.target.files || []);
        if (!allFiles.length) return;
        
        const readable = allFiles.filter(isReadableFile);
        
        if (readable.length === 0) {
            showToast("هیچ فایل قابل جستجویی پیدا نشد", "warning");
            haptic([20, 50, 20]);
            setTimeout(() => { el.filesInput.value = ""; }, 100);
            return;
        }
        
        state.allFiles = readable;
        state.files = readable.slice();
        state.selectedFileNames = new Set(readable.map(f => f.name));
        state.sourceType = "files";
        state.sourceName = `${readable.length} فایل`;
        
        updateSourceUI();
        haptic([10, 30, 10]);
        showToast(`${readable.length} فایل بارگذاری شد`, "success");
        
        setTimeout(() => { el.filesInput.value = ""; }, 100);
        clearResults();
    }
    
    // ═══════════════════════════════════════════════════════
    //  Source UI Update
    // ═══════════════════════════════════════════════════════
    
    function updateSourceUI() {
        const total = state.allFiles.length;
        const selected = state.selectedFileNames.size;
        
        if (total === 0) {
            el.sourceInfoBtn.classList.remove("has-source", "expanded");
            el.sourceIcon.textContent = "📭";
            el.sourceText.textContent = "هیچ منبعی انتخاب نشده";
            el.sourceBadge.style.display = "none";
            el.sourceArrow.style.display = "none";
            el.filePanel.style.display = "none";
            state.filePanelOpen = false;
            el.statusBar.textContent = "آماده";
            return;
        }
        
        el.sourceInfoBtn.classList.add("has-source");
        el.sourceIcon.textContent = state.sourceType === "folder" ? "📁" : "📄";
        el.sourceText.textContent = state.sourceName;
        el.sourceBadge.style.display = "inline-block";
        el.sourceBadge.textContent = `${selected}/${total}`;
        el.sourceArrow.style.display = "inline-block";
        
        el.statusBar.textContent = `${selected} از ${total} فایل فعال`;
        
        // اگه پنل باز بود، دوباره رندر کن
        if (state.filePanelOpen) {
            renderFileList(el.fileSearchInput.value);
        }
    }
    
    // ═══════════════════════════════════════════════════════
    //  File Panel Toggle
    // ═══════════════════════════════════════════════════════
    
    function toggleFilePanel() {
        if (state.allFiles.length === 0) {
            showToast("اول یه پوشه یا فایل انتخاب کن", "warning");
            haptic([20, 50, 20]);
            return;
        }
        
        haptic(10);
        state.filePanelOpen = !state.filePanelOpen;
        
        if (state.filePanelOpen) {
            el.filePanel.style.display = "block";
            el.sourceInfoBtn.classList.add("expanded");
            renderFileList(el.fileSearchInput.value);
        } else {
            el.filePanel.style.display = "none";
            el.sourceInfoBtn.classList.remove("expanded");
        }
    }
    
    // ═══════════════════════════════════════════════════════
    //  File List Render
    // ═══════════════════════════════════════════════════════
    
    function renderFileList(filter) {
        const q = (filter || "").trim().toLowerCase();
        
        let files = state.allFiles;
        if (q) {
            files = files.filter(f => {
                const name = f.name.toLowerCase();
                const path = (f.webkitRelativePath || "").toLowerCase();
                return name.indexOf(q) !== -1 || path.indexOf(q) !== -1;
            });
        }
        
        // شمارنده
        const total = state.allFiles.length;
        const selected = state.selectedFileNames.size;
        el.filePanelCount.textContent = `${selected} / ${total}`;
        
        // انتخاب همه
        el.selectAllCheck.checked = (selected === total && total > 0);
        el.selectAllCheck.indeterminate = (selected > 0 && selected < total);
        
        // اگه فایلی نبود
        if (files.length === 0) {
            el.fileList.innerHTML = `<div class="file-empty">هیچ فایلی مطابقت نداشت</div>`;
            return;
        }
        
        // محدودیت ۲۰۰ فایل در نمایش
        const display = files.slice(0, 200);
        
        el.fileList.innerHTML = display.map(f => {
            const path = f.webkitRelativePath || f.name;
            const isSelected = state.selectedFileNames.has(f.name);
            return `
                <div class="file-item${isSelected ? ' selected' : ''}" data-file="${escapeHtml(f.name)}">
                    <input type="checkbox" ${isSelected ? 'checked' : ''}>
                    <span class="file-name" title="${escapeHtml(path)}">${escapeHtml(path)}</span>
                    <button class="file-remove" type="button" title="حذف">✕</button>
                </div>
            `;
        }).join("");
        
        if (files.length > 200) {
            el.fileList.innerHTML += `<div class="file-empty">... و ${files.length - 200} فایل دیگر</div>`;
        }
        
        // رویدادها
        el.fileList.querySelectorAll(".file-item").forEach(item => {
            const name = item.dataset.file;
            if (!name) return;
            
            const checkbox = item.querySelector("input[type='checkbox']");
            const removeBtn = item.querySelector(".file-remove");
            
            // کلیک روی ردیف → toggle
            item.addEventListener("click", (e) => {
                if (e.target === removeBtn) return;
                if (e.target === checkbox) return;
                toggleFileSelection(name);
            });
            
            // checkbox تغییر
            if (checkbox) {
                checkbox.addEventListener("change", (e) => {
                    e.stopPropagation();
                    toggleFileSelection(name);
                });
            }
            
            // حذف تکی
            if (removeBtn) {
                removeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    removeFileCompletely(name);
                });
            }
        });
    }
    
    function toggleFileSelection(name) {
        haptic(5);
        if (state.selectedFileNames.has(name)) {
            state.selectedFileNames.delete(name);
        } else {
            state.selectedFileNames.add(name);
        }
        updateSelectedFiles();
        renderFileList(el.fileSearchInput.value);
        updateSourceUI();
    }
    
    function removeFileCompletely(name) {
        haptic(15);
        // حذف از همه جا
        state.allFiles = state.allFiles.filter(f => f.name !== name);
        state.selectedFileNames.delete(name);
        updateSelectedFiles();
        
        if (state.allFiles.length === 0) {
            // اگه همه حذف شدن
            state.sourceType = "";
            state.sourceName = "";
            updateSourceUI();
            clearResults();
            showToast("همه فایل‌ها حذف شدن", "warning");
        } else {
            renderFileList(el.fileSearchInput.value);
            updateSourceUI();
        }
    }
    
    function updateSelectedFiles() {
        state.files = state.allFiles.filter(f => state.selectedFileNames.has(f.name));
    }
    
    // ═══════════════════════════════════════════════════════
    //  Select All / Clear All
    // ═══════════════════════════════════════════════════════
    
    function handleSelectAll() {
        haptic(10);
        const total = state.allFiles.length;
        const selected = state.selectedFileNames.size;
        const allSelected = (selected === total && total > 0);
        
        if (allSelected) {
            // همه رو غیرفعال کن
            state.selectedFileNames.clear();
        } else {
            // همه رو فعال کن
            state.selectedFileNames = new Set(state.allFiles.map(f => f.name));
        }
        
        updateSelectedFiles();
        renderFileList(el.fileSearchInput.value);
        updateSourceUI();
    }
    
    function handleClearFiles() {
        haptic([20, 30, 20]);
        state.allFiles = [];
        state.selectedFileNames.clear();
        state.files = [];
        state.sourceType = "";
        state.sourceName = "";
        state.filePanelOpen = false;
        el.filePanel.style.display = "none";
        el.fileSearchInput.value = "";
        updateSourceUI();
        clearResults();
        showToast("همه فایل‌ها حذف شدن", "warning");
    }
    
    // ═══════════════════════════════════════════════════════
    //  Search
    // ═══════════════════════════════════════════════════════
    
    function doSearch() {
        if (state.isSearching) return;
        
        const query = el.searchInput.value.trim();
        
        if (!query) {
            haptic([20, 50, 20]);
            el.searchInput.focus();
            el.searchInput.parentElement.style.borderColor = "var(--red)";
            setTimeout(() => { el.searchInput.parentElement.style.borderColor = ""; }, 800);
            return;
        }
        
        if (state.files.length === 0) {
            haptic([20, 50, 20]);
            showToast("لطفاً اول یه پوشه یا فایل انتخاب کن", "warning");
            return;
        }
        
        haptic(15);
        
        state.isSearching = true;
        state.lastQuery = query;
        state.results = [];
        
        const wholeWord = el.wholeWordCheck.checked;
        let maxResults = parseInt(el.maxResults.value, 10);
        if (isNaN(maxResults) || maxResults < 10) maxResults = 100;
        if (maxResults > 10000) maxResults = 10000;
        
        el.searchBtn.style.display = "none";
        el.cancelBtn.style.display = "inline-flex";
        el.progressSection.classList.add("active");
        el.progressFill.style.width = "0%";
        el.progressText.textContent = "شروع...";
        el.progressPercent.textContent = "0%";
        el.statusBar.textContent = "🔍 در حال جستجو...";
        clearResultsList();
        
        state._startTime = Date.now();
        state._maxResults = maxResults;
        state._wholeWord = wholeWord;
        state._query = query;
        state._totalFiles = state.files.length;
        state._currentWorkerIndex = 0;
        
        runNextWorker();
    }
    
    function runNextWorker() {
        if (!state.isSearching) return;
        if (state._currentWorkerIndex >= state.files.length) {
            finishSearch();
            return;
        }
        if (state.results.length >= state._maxResults) {
            finishSearch();
            return;
        }
        
        const file = state.files[state._currentWorkerIndex];
        const fileIndex = state._currentWorkerIndex;
        
        state.worker = new Worker("js/search-worker.js");
        
        const updateProgress = () => {
            const cur = fileIndex + 1;
            const total = state._totalFiles;
            const pct = Math.round((cur / total) * 100);
            el.progressFill.style.width = pct + "%";
            el.progressText.textContent = `${cur}/${total} — ${file.name.slice(0, 30)}`;
            el.progressPercent.textContent = pct + "%";
        };
        
        updateProgress();
        
        state.worker.onmessage = function(e) {
            const msg = e.data;
            
            if (msg.type === "batch") {
                const remaining = state._maxResults - state.results.length;
                const toAdd = msg.results.slice(0, remaining);
                
                for (const r of toAdd) {
                    r.file = msg.filePath;
                    state.results.push(r);
                }
                
                if (toAdd.length > 0) {
                    appendResults(toAdd);
                    if (toAdd.length >= 50) haptic(5);
                }
                
                el.progressText.textContent =
                    `${fileIndex + 1}/${state._totalFiles} — ${state.results.length} نتیجه`;
                
            } else if (msg.type === "fileDone") {
                state._currentWorkerIndex++;
                if (state.worker) {
                    state.worker.terminate();
                    state.worker = null;
                }
                runNextWorker();
                
            } else if (msg.type === "error") {
                console.error("خطا در Worker:", msg.error);
                state._currentWorkerIndex++;
                if (state.worker) {
                    state.worker.terminate();
                    state.worker = null;
                }
                runNextWorker();
            }
        };
        
        state.worker.onerror = function(err) {
            console.error("Worker error:", err);
            state._currentWorkerIndex++;
            if (state.worker) {
                state.worker.terminate();
                state.worker = null;
            }
            runNextWorker();
        };
        
        state.worker.postMessage({
            action: "search",
            file: file,
            query: state._query,
            wholeWord: state._wholeWord,
            maxResults: state._maxResults - state.results.length,
            fileIndex: fileIndex,
            totalFiles: state._totalFiles,
            filePath: file.webkitRelativePath || file.name,
        });
    }
    
    function cancelSearch() {
        haptic([30, 30, 30]);
        if (state.worker) {
            state.worker.terminate();
            state.worker = null;
        }
        state.isSearching = false;
        finishSearch(true);
        showToast("⛔ جستجو لغو شد", "warning");
    }
    
    function finishSearch(cancelled) {
        state.isSearching = false;
        const elapsed = (Date.now() - state._startTime) / 1000;
        
        el.searchBtn.style.display = "inline-flex";
        el.cancelBtn.style.display = "none";
        el.progressSection.classList.remove("active");
        el.progressFill.style.width = "0%";
        
        el.timeBadge.textContent = `⏱ ${elapsed.toFixed(2)}s`;
        el.timeBadge.classList.add("active");
        
        el.resultsCount.textContent = `نتایج: ${state.results.length}`;
        
        if (cancelled) {
            el.statusBar.textContent = `⛔ لغو شد — ${state.results.length} نتیجه`;
        } else if (state.results.length === 0) {
            el.statusBar.textContent = `❌ نتیجه‌ای پیدا نشد — ${elapsed.toFixed(2)}s`;
            showEmptyState("❌ نتیجه‌ای پیدا نشد", "عبارت دیگه‌ای رو امتحان کن");
            haptic([20, 50, 20]);
        } else {
            el.statusBar.textContent = `✅ ${state.results.length} نتیجه — ${elapsed.toFixed(2)}s`;
            haptic([10, 30, 10]);
        }
    }
    
    // ═══════════════════════════════════════════════════════
    //  Render Results
    // ═══════════════════════════════════════════════════════
    
    function appendResults(newResults) {
        if (el.resultsList.querySelector(".empty-state")) {
            el.resultsList.innerHTML = "";
        }
        
        const startIndex = state.results.length - newResults.length;
        
        for (let i = 0; i < newResults.length; i++) {
            const r = newResults[i];
            const idx = startIndex + i;
            
            const item = document.createElement("div");
            item.className = "result-item";
            if (r.content_type && r.content_type !== "normal") {
                item.classList.add("type-" + r.content_type);
            }
            item.dataset.index = idx;
            item.style.animationDelay = (i * 20) + "ms";
            
            const header = document.createElement("div");
            header.className = "result-header";
            
            const fileSpan = document.createElement("span");
            fileSpan.className = "result-file";
            fileSpan.textContent = "📁 " + r.file;
            
            const lineSpan = document.createElement("span");
            lineSpan.className = "result-line";
            lineSpan.textContent = "خط " + r.line;
            
            header.appendChild(fileSpan);
            header.appendChild(lineSpan);
            
            const summary = document.createElement("div");
            summary.className = "result-summary";
            summary.innerHTML = colorizeSummary(r.summary || "—");
            
            const content = document.createElement("div");
            content.className = "result-content";
            const displayContent = r.content.length > 150
                ? r.content.slice(0, 150) + "..."
                : r.content;
            content.textContent = displayContent;
            
            item.appendChild(header);
            item.appendChild(summary);
            item.appendChild(content);
            
            item.addEventListener("click", () => openModal(idx));
            
            el.resultsList.appendChild(item);
        }
        
        el.resultsCount.textContent = `نتایج: ${state.results.length}`;
    }
    
    function colorizeSummary(summary) {
        if (!summary) return "—";
        let html = escapeHtml(summary);
        html = html.replace(/(https:\/\/t\.me\/[^\s•]+)/g, '<span class="hl-link">$1</span>');
        html = html.replace(/(tg:\/\/user\?id=\d+)/g, '<span class="hl-link">$1</span>');
        html = html.replace(/(📞\s*\d{10,13})/g, '<span class="hl-phone">$1</span>');
        html = html.replace(/(🆔\s*\d+)/g, '<span class="hl-id">$1</span>');
        return html;
    }
    
    function clearResultsList() {
        el.resultsList.innerHTML = "";
        el.resultsCount.textContent = "نتایج: 0";
        el.timeBadge.classList.remove("active");
    }
    
    function showEmptyState(text, hint) {
        el.resultsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <div class="empty-text">${escapeHtml(text)}</div>
                <div class="empty-hint">${escapeHtml(hint)}</div>
            </div>
        `;
    }
    
    function clearResults() {
        state.results = [];
        clearResultsList();
        showEmptyState("آماده برای جستجو", "یک پوشه یا فایل انتخاب کن و عبارت مورد نظر رو تایپ کن");
    }
    
    // ═══════════════════════════════════════════════════════
    //  Modal (View)
    // ═══════════════════════════════════════════════════════
    
    let currentModalResult = null;
    
    function openModal(index) {
        const r = state.results[index];
        if (!r) return;
        
        haptic(10);
        currentModalResult = r;
        
        el.modalTitle.textContent = `${r.file}:${r.line}`;
        
        const content = r.content;
        const extras = [];
        
        const tsMatch = content.match(/\\?"@timestamp\\?":\\?"([^"\\]+)\\?"/);
        if (tsMatch) extras.push(`📅 ${tsMatch[1].split("T")[0]}`);
        
        const wasOnlineMatch = content.match(/\\?"was_online\\?":(\d+)/);
        if (wasOnlineMatch) {
            const unixMs = parseInt(wasOnlineMatch[1], 10) * 1000;
            const d = new Date(unixMs);
            if (!isNaN(d.getTime())) {
                extras.push(`🕐 آخرین آنلاین: ${d.toISOString().split("T")[0]}`);
            }
        }
        
        const accessHashMatch = content.match(/\\?"access_hash\\?":\\?"(\d+)\\?"/);
        if (accessHashMatch) extras.push(`🔐 ${accessHashMatch[1]}`);
        
        let html = "";
        if (r.summary && r.summary !== "—") {
            html += `<div style="margin-bottom:6px">${colorizeSummary(r.summary)}</div>`;
        }
        if (extras.length > 0) {
            html += `<div style="color:var(--text-dim); font-size:12px">${extras.join("  •  ")}</div>`;
        }
        
        if (html) {
            el.modalSummary.innerHTML = html;
            el.modalSummary.classList.add("active");
        } else {
            el.modalSummary.classList.remove("active");
        }
        
        el.modalText.textContent = r.content;
        
        if (navigator.share) {
            el.modalShareBtn.style.display = "inline-flex";
        } else {
            el.modalShareBtn.style.display = "none";
        }
        
        el.viewModal.classList.add("active");
    }
    
    function closeModal() {
        el.viewModal.classList.remove("active");
        currentModalResult = null;
    }
    
    async function copyModalContent() {
        haptic(15);
        const text = el.modalText.textContent;
        try {
            await navigator.clipboard.writeText(text);
            showToast("📋 محتوا کپی شد", "success");
        } catch (e) {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            showToast("📋 محتوا کپی شد", "success");
        }
    }
    
    async function shareModalContent() {
        if (!currentModalResult) return;
        haptic(15);
        
        const r = currentModalResult;
        const shareText = `${r.file}:${r.line}\n${r.summary || ""}\n\n${r.content}`;
        
        try {
            await navigator.share({
                title: "Search of Sky",
                text: shareText,
            });
        } catch (e) {
            if (e.name !== "AbortError") {
                showToast("اشتراک‌گذاری ناموفق", "error");
            }
        }
    }
    
    // ═══════════════════════════════════════════════════════
    //  Copy All
    // ═══════════════════════════════════════════════════════
    
    async function copyAll() {
        if (!state.results.length) {
            showToast("چیزی برای کپی وجود نداره", "warning");
            return;
        }
        
        haptic(15);
        
        const text = state.results
            .map(r => `${r.file}:${r.line}\t${r.content}`)
            .join("\n");
        
        try {
            await navigator.clipboard.writeText(text);
            showToast(`📋 ${state.results.length} نتیجه کپی شد`, "success");
        } catch (e) {
            const ta = document.createElement("textarea");
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            showToast(`📋 ${state.results.length} نتیجه کپی شد`, "success");
        }
    }
    
    // ═══════════════════════════════════════════════════════
    //  Clear
    // ═══════════════════════════════════════════════════════
    
    function clearAll() {
        haptic(10);
        if (state.isSearching) cancelSearch();
        el.searchInput.value = "";
        state.lastQuery = "";
        clearResults();
        el.statusBar.textContent = "آماده";
        el.searchInput.focus();
    }
    
    function clearInput() {
        haptic(5);
        el.searchInput.value = "";
        el.searchInput.focus();
    }
    
    function clearFileSearch() {
        haptic(5);
        el.fileSearchInput.value = "";
        renderFileList("");
        el.fileSearchInput.focus();
    }
    
    // ═══════════════════════════════════════════════════════
    //  Service Worker
    // ═══════════════════════════════════════════════════════
    
    async function registerServiceWorker() {
        if (!("serviceWorker" in navigator)) return;
        try {
            const reg = await navigator.serviceWorker.register("service-worker.js", {
                scope: "./"
            });
            console.log("✅ Service Worker ثبت شد:", reg.scope);
        } catch (e) {
            console.error("❌ خطا در ثبت Service Worker:", e);
        }
    }
    
    // ═══════════════════════════════════════════════════════
    //  PWA Install
    // ═══════════════════════════════════════════════════════
    
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        state.deferredPrompt = e;
        el.installBtn.style.display = "inline-flex";
    });
    
    async function installApp() {
        haptic([20, 30, 20]);
        if (!state.deferredPrompt) {
            showToast("برای نصب، از منوی مرورگر «Add to Home Screen» رو بزن", "info");
            return;
        }
        state.deferredPrompt.prompt();
        const { outcome } = await state.deferredPrompt.userChoice;
        if (outcome === "accepted") {
            showToast("✅ اپ نصب شد", "success");
            el.installBtn.style.display = "none";
        }
        state.deferredPrompt = null;
    }
    
    window.addEventListener("appinstalled", () => {
        state.deferredPrompt = null;
        el.installBtn.style.display = "none";
        showToast("🎉 اپ با موفقیت نصب شد", "success");
    });
    
    // ═══════════════════════════════════════════════════════
    //  Event Listeners
    // ═══════════════════════════════════════════════════════
    
    function bindEvents() {
        el.themeBtn.addEventListener("click", toggleTheme);
        el.installBtn.addEventListener("click", installApp);
        el.helpBtn.addEventListener("click", showWelcome);
        el.searchBtn.addEventListener("click", doSearch);
        el.cancelBtn.addEventListener("click", cancelSearch);
        el.clearBtn.addEventListener("click", clearAll);
        el.folderBtn.addEventListener("click", chooseFolder);
        el.filesBtn.addEventListener("click", chooseFiles);
        el.folderInput.addEventListener("change", onFolderSelected);
        el.filesInput.addEventListener("change", onFilesSelected);
        el.clearInputBtn.addEventListener("click", clearInput);
        el.clearFileSearchBtn.addEventListener("click", clearFileSearch);
        el.copyAllBtn.addEventListener("click", copyAll);
        
        // Source info toggle
        el.sourceInfoBtn.addEventListener("click", toggleFilePanel);
        
        // Select all / clear all
        el.selectAllCheck.addEventListener("change", handleSelectAll);
        el.clearFilesBtn.addEventListener("click", handleClearFiles);
        
        // File search
        el.fileSearchInput.addEventListener("input", (e) => {
            renderFileList(e.target.value);
        });
        
        // Search input
        el.searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                doSearch();
            }
        });
        
        // Modal
        el.modalCloseBtn.addEventListener("click", closeModal);
        el.modalCloseBtn2.addEventListener("click", closeModal);
        el.modalCopyBtn.addEventListener("click", copyModalContent);
        el.modalShareBtn.addEventListener("click", shareModalContent);
        
        el.viewModal.addEventListener("click", (e) => {
            if (e.target === el.viewModal) closeModal();
        });
        
        // Welcome
        el.welcomeCloseBtn.addEventListener("click", closeWelcome);
        el.welcomeCloseBtn2.addEventListener("click", closeWelcome);
        el.welcomeStartBtn.addEventListener("click", closeWelcome);
        
        el.welcomeModal.addEventListener("click", (e) => {
            if (e.target === el.welcomeModal) closeWelcome();
        });
        
        // Keyboard shortcuts
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                closeModal();
                if (el.welcomeModal.classList.contains("active")) closeWelcome();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "f") {
                e.preventDefault();
                el.searchInput.focus();
                el.searchInput.select();
            }
        });
        
        // Back button برای modal
        window.addEventListener("popstate", () => {
            if (el.viewModal.classList.contains("active")) closeModal();
        });
    }
    
    // ═══════════════════════════════════════════════════════
    //  Init
    // ═══════════════════════════════════════════════════════
    
    function init() {
        loadTheme();
        bindEvents();
        el.statusBar.textContent = "آماده";
        
        registerServiceWorker();
        hideSplash();
        checkFirstVisit();
        
        console.log("✅ Search of Sky PWA initialized (v2.2)");
    }
    
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
    
})();