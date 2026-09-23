/* ============================================================
   Search of Sky — Search Worker (v3)
   BATCH_SIZE پویا + Streaming + لاگ دیباگ
   ============================================================ */

'use strict';

// ═══════════════════════════════════════════════════════════
//  ثابت‌ها
// ═══════════════════════════════════════════════════════════

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS  = "٠١٢٣٤٥٦٧٨٩";
const LATIN_DIGITS   = "0123456789";

const CHAR_MAP = {
    'ي': 'ی', 'ى': 'ی', 'ﻯ': 'ی', 'ﻰ': 'ی',
    'ك': 'ک', 'ﻙ': 'ک', 'ﻚ': 'ک',
    'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ٲ': 'ا',
    'ة': 'ه', 'ۀ': 'ه', 'ؤ': 'و', 'ئ': 'ی',
    '\u200c': ' ', '\u200d': '', '\u200e': '', '\u200f': '',
};

const DIACRITICS_RE = /[\u064B-\u065F\u0670\u0640]/g;
const MULTI_SPACE_RE = /[ \t]+/g;

const SPECIAL_CHARS = new Set(
    "يىﻯﻰكﻙﻚأإآٱٲةۀؤئ\u200c\u200d\u200e\u200f" +
    "\u064B\u064C\u064D\u064E\u064F\u0650\u0651\u0652\u0653\u0654\u0655" +
    "\u0656\u0657\u0658\u0659\u065A\u065B\u065C\u065D\u065E\u065F\u0670\u0640" +
    "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩"
);

const PERSIAN_FAST_FIX = {
    'ي': 'ی', 'ى': 'ی', 'ﻯ': 'ی', 'ﻰ': 'ی',
    'ك': 'ک', 'ﻙ': 'ک', 'ﻚ': 'ک',
    'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ٲ': 'ا',
    'ة': 'ه', 'ۀ': 'ه', 'ؤ': 'و', 'ئ': 'ی',
};

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 مگ (کوچیک‌تر برای پایداری)

function getBatchSize(fileSize) {
    const MB = 1024 * 1024;
    if (fileSize < 10 * MB) return 5;
    if (fileSize < 50 * MB) return 20;
    if (fileSize < 100 * MB) return 50;
    return 100;
}

// ═══════════════════════════════════════════════════════════
//  توابع پایه
// ═══════════════════════════════════════════════════════════

function normalizeDigits(text) {
    if (!text) return "";
    let result = "";
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const pIdx = PERSIAN_DIGITS.indexOf(ch);
        if (pIdx >= 0) { result += LATIN_DIGITS[pIdx]; continue; }
        const aIdx = ARABIC_DIGITS.indexOf(ch);
        if (aIdx >= 0) { result += LATIN_DIGITS[aIdx]; continue; }
        result += ch;
    }
    return result;
}

function normalizePersian(text) {
    if (!text) return "";
    let hasSpecial = false;
    for (let i = 0; i < text.length; i++) {
        if (SPECIAL_CHARS.has(text[i])) { hasSpecial = true; break; }
    }
    if (!hasSpecial) return text.trim();
    let result = "";
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        result += CHAR_MAP[ch] !== undefined ? CHAR_MAP[ch] : ch;
    }
    result = normalizeDigits(result);
    result = result.replace(DIACRITICS_RE, "");
    result = result.replace(MULTI_SPACE_RE, " ");
    return result.trim();
}

function persianFastFix(text) {
    if (!text) return "";
    let result = "";
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        result += PERSIAN_FAST_FIX[ch] !== undefined ? PERSIAN_FAST_FIX[ch] : ch;
    }
    return result;
}

function cleanDigits(text) {
    if (!text) return "";
    let result = normalizeDigits(text);
    for (const ch of [" ", "-", "_", ".", "(", ")", "\t"]) {
        result = result.split(ch).join("");
    }
    return result;
}

function isNumericQuery(query) {
    if (!query) return false;
    const q = cleanDigits(query);
    return q.length > 0 && /^\d+$/.test(q);
}

function isMobileNumber(q) {
    if (!q || !/^\d+$/.test(q)) return false;
    if (q.length === 10 && q.startsWith("9")) return true;
    if (q.length === 11 && q.startsWith("09")) return true;
    if (q.length === 12 && q.startsWith("989")) return true;
    if (q.length === 14 && q.startsWith("00989")) return true;
    return false;
}

function extractPhoneVariants(query) {
    let q = cleanDigits(query);
    if (!/^\d+$/.test(q)) return [q];
    q = q.replace(/^\+/, "");
    if (q.startsWith("00")) q = q.slice(2);
    const variants = new Set();
    if (!isMobileNumber(q)) {
        variants.add(q);
        if (q.startsWith("0")) variants.add(q.slice(1));
        else variants.add("0" + q);
        return Array.from(variants).sort((a, b) => a.length - b.length);
    }
    variants.add(q);
    if (q.startsWith("98") && q.length > 10) {
        const core = q.slice(2);
        variants.add(core);
        variants.add("0" + core);
        variants.add("+98" + core);
    } else if (q.startsWith("0")) {
        const core = q.slice(1);
        variants.add(core);
        variants.add("98" + core);
        variants.add("+98" + core);
    } else if (q.startsWith("0098")) {
        const core = q.slice(4);
        variants.add("98" + core);
        variants.add("0" + core);
        variants.add(core);
    } else if (q.length === 10) {
        variants.add("0" + q);
        variants.add("98" + q);
        variants.add("+98" + q);
    }
    return Array.from(variants).sort((a, b) => a.length - b.length);
}

function prepareQuery(query) {
    query = (query || "").trim();
    if (isNumericQuery(query)) {
        return { type: "NUMBER", data: extractPhoneVariants(query) };
    }
    const words = query.split(/\s+/).filter(w => w);
    const normTerms = [];
    const seen = new Set();
    for (const w of words) {
        const n = normalizePersian(w);
        if (n && !seen.has(n)) { seen.add(n); normTerms.push(n); }
    }
    return { type: "TEXT", data: normTerms };
}

// ═══════════════════════════════════════════════════════════
//  تشخیص نوع محتوا
// ═══════════════════════════════════════════════════════════

function detectContentType(content, filepath) {
    const fpLower = (filepath || "").toLowerCase().replace(/\\/g, "/");
    const mobileKw = ["irancell", "iran cell", "همراه اول", "mci", "mtn",
                      "rightel", "رایتل", "mobile", "موبایل",
                      "db irancell", "/935", "0935", "0941", "/941"];
    for (const kw of mobileKw) {
        if (fpLower.indexOf(kw) !== -1) return "mobile";
    }
    if (fpLower.indexOf("telegram") !== -1 || fpLower.indexOf("rahma") !== -1) {
        return "telegram";
    }
    const bankKw = ["bank", "saderat", "sepah", "tejarat", "melli",
                    "mellat", "parsian", "pasargad", "saman", "refah"];
    for (const kw of bankKw) {
        if (fpLower.indexOf(kw) !== -1) return "bank";
    }
    if (fpLower.indexOf("facebook") !== -1 || fpLower.indexOf("instagram") !== -1) {
        return "social";
    }
    if (/%?B?\d{16}\^/.test(content)) return "bank";
    if (content.indexOf('"phone"') !== -1 && content.indexOf('"first_name"') !== -1) {
        return "telegram";
    }
    return "normal";
}

// ═══════════════════════════════════════════════════════════
//  خلاصه‌سازی
// ═══════════════════════════════════════════════════════════

function summarizeTelegram(content) {
    if (content.indexOf('"phone"') === -1 &&
        content.indexOf('"first_name"') === -1 &&
        content.indexOf('"last_name"') === -1) {
        return "";
    }
    const get = (name) => {
        const re = new RegExp('\\\\?"' + name + '\\\\?":\\\\?"([^"\\\\]+)\\\\?"');
        const m = content.match(re);
        return m ? m[1].trim() : "";
    };
    const first = get("first_name");
    const last = get("last_name");
    const phone = get("phone");
    const username = get("username");
    let id = "";
    const idMatch = content.match(/\\?"id\\?":(\d+)/);
    if (idMatch) id = idMatch[1];
    if (!first && !last && !phone && !id && !username) return "";
    const parts = [];
    if (first || last) parts.push(`👤 ${(first + " " + last).trim()}`);
    if (phone) parts.push(`📞 ${phone}`);
    if (username) parts.push(`@${username}`);
    if (id) parts.push(`🆔 ${id}`);
    if (username) parts.push(`🔗 https://t.me/${username}`);
    else if (id) parts.push(`🔗 tg://user?id=${id}`);
    return parts.join("  •  ");
}

function summarizeStructured(fields) {
    const clean = fields
        .map(f => f.replace(/[\s\u00a0\t]+/g, " ").trim())
        .filter(f => f);
    if (!clean.length) return "";
    const parts = [];
    const used = new Set();
    let mobile = null;
    for (let i = 0; i < clean.length; i++) {
        if (used.has(i)) continue;
        const f = clean[i];
        if (/^0?9\d{9}$/.test(f) || /^989\d{9}$/.test(f) || /^9\d{9}$/.test(f)) {
            mobile = f; used.add(i); break;
        }
    }
    let nationalId = null;
    for (let i = 0; i < Math.min(clean.length, 6); i++) {
        if (used.has(i)) continue;
        if (/^\d{10}$/.test(clean[i])) { nationalId = clean[i]; used.add(i); break; }
    }
    let landline = null;
    for (let i = 0; i < clean.length; i++) {
        if (used.has(i)) continue;
        const f = clean[i];
        if (/^0\d{2,3}-?\d{7,8}$/.test(f) || /^\d{3}-?\d{7,8}$/.test(f)) {
            landline = f; used.add(i); break;
        }
    }
    let postalCode = null;
    for (let i = clean.length - 1; i >= Math.max(clean.length - 3, 0); i--) {
        if (used.has(i)) continue;
        if (/^\d{10}$/.test(clean[i])) { postalCode = clean[i]; used.add(i); break; }
    }
    const nameParts = [];
    for (let i = 0; i < Math.min(clean.length, 5); i++) {
        if (used.has(i)) continue;
        const f = clean[i];
        if (/^[\u0600-\u06FF\s]+$/.test(f) && f.length >= 2 && f.length <= 20) {
            nameParts.push(f); used.add(i);
            if (nameParts.length >= 2) break;
        }
    }
    const provinces = [
        'تهران', 'اصفهان', 'فارس', 'خراسان رضوی', 'خراسان شمالی', 'خراسان جنوبی',
        'آذربایجان شرقی', 'آذربایجان غربی', 'خوزستان', 'مازندران', 'گیلان',
        'کرمان', 'کرمانشاه', 'سیستان و بلوچستان', 'هرمزگان', 'همدان',
        'لرستان', 'گلستان', 'اردبیل', 'قزوین', 'مرکزی', 'زنجان',
        'یزد', 'قم', 'البرز', 'کردستان', 'بوشهر', 'سمنان',
    ];
    let province = null;
    for (let i = 0; i < clean.length; i++) {
        if (used.has(i)) continue;
        const f = clean[i];
        if (provinces.indexOf(f) !== -1) { province = f; used.add(i); break; }
        if (f.length > 15) {
            let found = false;
            for (const prov of provinces) {
                if (f.endsWith(prov)) {
                    province = prov;
                    const newF = f.slice(0, -prov.length).trim();
                    if (newF) clean[i] = newF; else used.add(i);
                    found = true; break;
                }
                if (f.slice(-(prov.length + 5)).indexOf(prov) !== -1) {
                    province = prov;
                    const idx = f.lastIndexOf(prov);
                    const newF = f.slice(0, idx).trim();
                    if (newF) clean[i] = newF; else used.add(i);
                    found = true; break;
                }
            }
            if (found) break;
        }
    }
    let neighborhood = null;
    for (let i = 0; i < clean.length; i++) {
        if (used.has(i)) continue;
        const f = clean[i];
        if (f.length <= 25 && /^[\u0600-\u06FF\s]+$/.test(f)) {
            const kws = ['کوی', 'محله', 'شهرک', 'دهکوی', 'دهمکوی'];
            let found = false;
            for (const k of kws) { if (f.indexOf(k) !== -1) { found = true; break; } }
            if (found) { neighborhood = f; used.add(i); break; }
        }
        if (f.length <= 15 && /^[\u0600-\u06FF]+$/.test(f)) {
            let skip = false;
            for (const n of nameParts) { if (f.indexOf(n) !== -1) { skip = true; break; } }
            if (!skip) { neighborhood = f; used.add(i); break; }
        }
    }
    let address = null;
    const remaining = [];
    for (let i = 0; i < clean.length; i++) {
        if (!used.has(i) && clean[i].length >= 8) remaining.push([i, clean[i]]);
    }
    if (remaining.length) {
        remaining.sort((a, b) => b[1].length - a[1].length);
        address = remaining[0][1];
    }
    if (mobile) {
        let mobileDisplay = mobile;
        if (/^9\d{9}$/.test(mobile)) mobileDisplay = "0" + mobile;
        parts.push(`📞 ${mobileDisplay}`);
    }
    if (nameParts.length) parts.push(`👤 ${nameParts.join(" ")}`);
    if (nationalId) parts.push(`🆔 ${nationalId}`);
    if (landline) parts.push(`☎ ${landline}`);
    if (province) parts.push(`🗺 ${province}`);
    if (neighborhood) parts.push(`🏘 ${neighborhood}`);
    if (address) {
        const disp = address.length <= 50 ? address : address.slice(0, 47) + "...";
        parts.push(`🏠 ${disp}`);
    }
    if (postalCode) parts.push(`📮 ${postalCode}`);
    if (parts.length) return parts.join("  •  ");
    return clean.slice(0, 5).join("  •  ");
}

function extractSummary(content) {
    const tg = summarizeTelegram(content);
    if (tg) return tg;
    const track2 = content.match(/%?B?(\d{16})\^([^^]*)\^/);
    if (track2) {
        const parts = [`💳 ${track2[1]}`];
        if (track2[2].trim()) parts.push(`👤 ${track2[2].trim()}`);
        const dateM = content.match(/\b(1[34]\d{2}[/\-]\d{1,2}[/\-]\d{1,2})\b/);
        if (dateM) parts.push(`📅 ${dateM[1]}`);
        return parts.join("  •  ");
    }
    const quoted = content.match(/'([^']*)'/g);
    if (quoted && quoted.length >= 3) {
        const fields = quoted.map(q => q.slice(1, -1));
        return summarizeStructured(fields);
    }
    const stripped = content.trim();
    if (stripped.length < 5) return stripped;
    if (stripped.length <= 120) return stripped;
    return "";
}

// ═══════════════════════════════════════════════════════════
//  جستجو در متن
// ═══════════════════════════════════════════════════════════

function searchNumberInText(text, queryVariants, filepath, maxResults, startLineNum) {
    const results = [];
    const lines = text.split(/\r?\n/);
    const maxLen = Math.max.apply(null, queryVariants.map(v => v.length));
    startLineNum = startLineNum || 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.length < 3) continue;
        if (line.startsWith('{"index"')) continue;
        for (let v = 0; v < queryVariants.length; v++) {
            const variant = queryVariants[v];
            const idx = line.indexOf(variant);
            if (idx === -1) continue;
            if (variant.length >= maxLen) {
                const before = idx > 0 ? line[idx - 1] : "";
                const after = idx + variant.length < line.length ? line[idx + variant.length] : "";
                if (/\d/.test(before) || /\d/.test(after)) continue;
            }
            const ctype = detectContentType(line, filepath);
            results.push({
                line: startLineNum + i + 1,
                content: line.trim(),
                summary: extractSummary(line),
                content_type: ctype,
            });
            break;
        }
        if (results.length >= maxResults) break;
    }
    return results;
}

function searchTextInText(text, queryTerms, filepath, wholeWord, maxResults, startLineNum) {
    const results = [];
    const lines = text.split(/\r?\n/);
    const queryNorm = queryTerms.map(t => normalizePersian(t).toLowerCase());
    startLineNum = startLineNum || 0;
    let patterns = null;
    if (wholeWord) {
        patterns = queryTerms.map(t => {
            const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(?<![^\\s،,;:.!?])${esc}(?![^\\s،,;:.!?])`, 'iu');
        });
    }
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.length < 3) continue;
        if (line.startsWith('{"index"')) continue;
        const fixed = persianFastFix(line).toLowerCase();
        let ok = true;
        for (let j = 0; j < queryNorm.length; j++) {
            if (fixed.indexOf(queryNorm[j]) === -1) { ok = false; break; }
        }
        if (!ok) continue;
        const norm = normalizePersian(line).toLowerCase();
        if (wholeWord) {
            ok = true;
            for (let j = 0; j < patterns.length; j++) {
                if (!patterns[j].test(normalizePersian(line))) { ok = false; break; }
            }
        } else {
            ok = true;
            for (let j = 0; j < queryNorm.length; j++) {
                if (norm.indexOf(queryNorm[j]) === -1) { ok = false; break; }
            }
        }
        if (ok) {
            const ctype = detectContentType(line, filepath);
            results.push({
                line: startLineNum + i + 1,
                content: line.trim(),
                summary: extractSummary(line),
                content_type: ctype,
            });
            if (results.length >= maxResults) break;
        }
    }
    return results;
}

// ═══════════════════════════════════════════════════════════
//  جستجو با Streaming
// ═══════════════════════════════════════════════════════════

async function searchFileStreaming(file, queryInfo, wholeWord, maxResults,
                                    fileIndex, filePath, onBatch) {
    const size = file.size;
    const batchSize = getBatchSize(size);
    let currentBatch = [];
    let totalFound = 0;
    
    const flushBatch = () => {
        if (currentBatch.length > 0) {
            onBatch(currentBatch);
            currentBatch = [];
        }
    };
    
    const processResults = (results) => {
        for (const r of results) {
            currentBatch.push(r);
            totalFound++;
            if (currentBatch.length >= batchSize) flushBatch();
            if (totalFound >= maxResults) break;
        }
    };
    
    // فایل کوچیک
    if (size < 50 * 1024 * 1024) {
        console.log("[WORKER] فایل کوچیک — readAsText");
        let text = "";
        try { text = await file.text(); } catch (e) { 
            console.error("[WORKER] خطا در readAsText:", e);
            return; 
        }
        if (!text) return;
        console.log("[WORKER] متن خونده شد، طول:", text.length);
        
        let results;
        if (queryInfo.type === "NUMBER") {
            results = searchNumberInText(text, queryInfo.data, filePath, maxResults, 0);
        } else {
            results = searchTextInText(text, queryInfo.data, filePath, wholeWord, maxResults, 0);
        }
        console.log("[WORKER] نتایج پیدا شده:", results.length);
        processResults(results);
        flushBatch();
        return;
    }
    
    // فایل بزرگ — chunk
    console.log("[WORKER] فایل بزرگ — chunk-based");
    let offset = 0;
    let lineOffset = 0;
    let leftover = "";
    
    while (offset < size) {
        if (totalFound >= maxResults) break;
        const end = Math.min(offset + CHUNK_SIZE, size);
        const blob = file.slice(offset, end);
        let chunk = "";
        try {
            chunk = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsText(blob, "utf-8");
            });
        } catch (e) {
            console.error("[WORKER] خطا در خواندن chunk:", e);
            break;
        }
        const combined = leftover + chunk;
        const lines = combined.split(/\r?\n/);
        const isLastChunk = end >= size;
        if (!isLastChunk) leftover = lines.pop() || "";
        else leftover = "";
        const chunkText = lines.join("\n");
        const remaining = maxResults - totalFound;
        let chunkResults;
        if (queryInfo.type === "NUMBER") {
            chunkResults = searchNumberInText(
                chunkText, queryInfo.data, filePath, remaining, lineOffset
            );
        } else {
            chunkResults = searchTextInText(
                chunkText, queryInfo.data, filePath, wholeWord, remaining, lineOffset
            );
        }
        processResults(chunkResults);
        lineOffset += lines.length;
        offset = end;
    }
    flushBatch();
}

// ═══════════════════════════════════════════════════════════
//  پیام‌گیر
// ═══════════════════════════════════════════════════════════

self.onmessage = async function(event) {
    const msg = event.data;
    console.log("[WORKER] پیام دریافت شد:", msg.action);
    
    if (msg.action !== "search") return;
    
    const file = msg.file;
    const query = msg.query;
    const wholeWord = msg.wholeWord;
    const maxResults = msg.maxResults;
    const fileIndex = msg.fileIndex;
    const totalFiles = msg.totalFiles;
    const filePath = msg.filePath;
    
    console.log("[WORKER] file:", file ? file.name : "NULL", "size:", file ? file.size : 0);
    console.log("[WORKER] query:", query);
    
    let queryInfo;
    try {
        queryInfo = prepareQuery(query);
        console.log("[WORKER] queryInfo:", JSON.stringify(queryInfo));
    } catch (e) {
        console.error("[WORKER] خطا در prepareQuery:", e);
        self.postMessage({
            type: "error", fileIndex, filePath,
            error: "prepareQuery: " + String(e),
        });
        return;
    }
    
    self.postMessage({
        type: "start",
        fileIndex: fileIndex,
        filePath: filePath,
        totalFiles: totalFiles,
    });
    
    try {
        await searchFileStreaming(
            file, queryInfo, wholeWord, maxResults,
            fileIndex, filePath,
            (batch) => {
                if (batch.length > 0) {
                    self.postMessage({
                        type: "batch",
                        fileIndex: fileIndex,
                        filePath: filePath,
                        results: batch,
                    });
                }
            }
        );
        
        self.postMessage({
            type: "fileDone",
            fileIndex: fileIndex,
            filePath: filePath,
            totalFiles: totalFiles,
        });
    } catch (e) {
        console.error("[WORKER] خطای کلی:", e);
        self.postMessage({
            type: "error",
            fileIndex: fileIndex,
            filePath: filePath,
            error: String(e) + "\n" + (e.stack || ""),
        });
    }
};