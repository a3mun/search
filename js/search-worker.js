/* ============================================================
   Search of Sky — Search Worker (v4.1)
   اضافه شد: پشتیبانی کامل از HTML (پارس جدول) + NUMBER
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

const CHUNK_SIZE = 5 * 1024 * 1024;

// ✅ پسوندهای HTML
const HTML_EXTENSIONS = [".htm", ".html", ".xhtml", ".xht"];

// ✅ Regex برای جدول HTML
const TR_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
const TD_RE = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
const HTML_TAG_RE = /<[^>]+>/g;
const SCRIPT_STYLE_RE = /<(script|style)[\s\S]*?<\/\1>/gi;

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
//  ✅ HTML Parsing
// ═══════════════════════════════════════════════════════════

function decodeHtmlEntities(text) {
    if (!text) return "";
    return text
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripHtmlTags(html) {
    if (!html) return "";
    let text = html
        .replace(SCRIPT_STYLE_RE, " ")
        .replace(HTML_TAG_RE, " ");
    text = decodeHtmlEntities(text);
    text = text.replace(/[ \t\u00a0]+/g, " ").trim();
    return text;
}

/**
 * استخراج ردیف‌های جدول HTML
 * برمی‌گردونه: آرایه‌ی آرایه‌ها (هر آرایه = یک ردیف از سلول‌های تمیز)
 */
function parseHtmlTableRows(htmlContent) {
    const rows = [];
    let trMatch;
    
    TR_RE.lastIndex = 0;
    while ((trMatch = TR_RE.exec(htmlContent)) !== null) {
        const trContent = trMatch[1];
        const cells = [];
        
        TD_RE.lastIndex = 0;
        let tdMatch;
        while ((tdMatch = TD_RE.exec(trContent)) !== null) {
            let cell = tdMatch[1];
            cell = cell.replace(HTML_TAG_RE, " ");
            cell = decodeHtmlEntities(cell);
            cell = cell.replace(/\s+/g, " ").trim();
            cells.push(cell);
        }
        
        if (cells.length > 0 && cells.some(c => c)) {
            rows.push(cells);
        }
    }
    
    return rows;
}

/**
 * انتخاب آیکون مناسب برای سلول HTML
 */
function pickHtmlIcon(cell, colName) {
    const col = (colName || "").trim();
    const colLower = col.toLowerCase();
    const cellClean = (cell || "").trim();
    
    if (col.indexOf("تلفن") !== -1 || col.indexOf("همراه") !== -1 || colLower.indexOf("tel") !== -1) return "📞";
    if (col.indexOf("ملی") !== -1) return "🆔";
    if (col.indexOf("پدر") !== -1) return "👨";
    if (col.indexOf("جنسیت") !== -1) {
        if (cellClean.indexOf("دختر") !== -1) return "👧";
        if (cellClean.indexOf("پسر") !== -1) return "👦";
        return "👤";
    }
    if (col.indexOf("نام و") !== -1 || col.indexOf("نام خانوادگی") !== -1) return "👤";
    if (col === "نام") return "👤";
    if (col.indexOf("آدرس") !== -1 || col.indexOf("نشانی") !== -1) return "🏠";
    if (col.indexOf("استان") !== -1 || colLower.indexOf("province") !== -1) return "🗺";
    if (col.indexOf("شهر") !== -1 || colLower.indexOf("city") !== -1) return "🏙";
    if (col.indexOf("محله") !== -1) return "🏘";
    if (col.indexOf("پستی") !== -1 || colLower.indexOf("postal") !== -1) return "📮";
    if (col.indexOf("پایه") !== -1 || col.indexOf("کلاس") !== -1) return "📚";
    if (col.indexOf("تاریخ") !== -1) return "📅";
    if (col.indexOf("ردیف") !== -1) return "";
    
    // بر اساس محتوا
    if (/^\d{10}$/.test(cellClean)) return "🆔";
    if (/^0?9\d{9}$/.test(cellClean) || /^989\d{9}$/.test(cellClean)) return "📞";
    if (/^\d{16}$/.test(cellClean)) return "💳";
    if (cellClean === "دختر") return "👧";
    if (cellClean === "پسر") return "👦";
    if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(cellClean)) return "📅";
    
    return "";
}

/**
 * خلاصه‌سازی از ردیف جدول HTML
 */
function summarizeHtmlRow(header, cells) {
    if (!cells || cells.length === 0) return "";
    
    const parts = [];
    
    if (header && header.length === cells.length) {
        const skipIdx = new Set();
        header.forEach((h, i) => {
            const hc = (h || "").trim();
            if (["ردیف", "رديف", "شماره", "#", "id"].indexOf(hc) !== -1) {
                skipIdx.add(i);
            }
        });
        
        // جمع‌آوری آدرس (استان + شهر + آدرس)
        let province = "", city = "", address = "";
        header.forEach((h, i) => {
            const hLower = (h || "").toLowerCase().trim();
            const val = (cells[i] || "").trim();
            if (!val) return;
            
            if (h.indexOf("استان") !== -1 || hLower.indexOf("province") !== -1) province = val;
            else if (h.indexOf("شهر") !== -1 || hLower.indexOf("city") !== -1 || hLower.indexOf("town") !== -1) city = val;
            else if (h.indexOf("آدرس") !== -1 || h.indexOf("نشانی") !== -1 || hLower.indexOf("address") !== -1) address = val;
        });
        
        if (province || city || address) {
            const addrParts = [province, city, address].filter(x => x);
            let addrText = addrParts.join(" - ");
            if (addrText.length > 60) addrText = addrText.slice(0, 57) + "...";
            parts.push(`🏠 ${addrText}`);
        }
        
        let processedAddr = false;
        
        cells.forEach((cell, i) => {
            if (skipIdx.has(i)) return;
            cell = (cell || "").trim();
            if (!cell) return;
            
            const colName = header[i] ? header[i].trim() : "";
            const hLower = colName.toLowerCase();
            
            // skip ستون‌های آدرس (قبلاً نمایش داده شد)
            if (colName.indexOf("استان") !== -1 || hLower.indexOf("province") !== -1 ||
                colName.indexOf("شهر") !== -1 || hLower.indexOf("city") !== -1 ||
                colName.indexOf("آدرس") !== -1 || colName.indexOf("نشانی") !== -1 ||
                hLower.indexOf("address") !== -1) {
                if (processedAddr) return;
                processedAddr = true;
                return;
            }
            
            const icon = pickHtmlIcon(cell, colName);
            const display = cell.length <= 45 ? cell : cell.slice(0, 42) + "...";
            
            if (icon) parts.push(`${icon} ${display}`);
            else parts.push(display);
        });
    } else {
        // بدون هدر: اگه اولین سلول عدده، skip
        const startIdx = (cells[0] && /^\d{1,4}$/.test(cells[0].trim())) ? 1 : 0;
        for (let i = startIdx; i < cells.length; i++) {
            const cell = (cells[i] || "").trim();
            if (!cell) continue;
            const display = cell.length <= 45 ? cell : cell.slice(0, 42) + "...";
            parts.push(display);
        }
    }
    
    return parts.join("  •  ");
}

/**
 * جستجو در محتوای HTML (پارس جدول)
 */
function searchHtmlContent(htmlContent, queryInfo, wholeWord, maxResults, filepath) {
    const results = [];
    const rows = parseHtmlTableRows(htmlContent);
    
    if (rows.length === 0) {
        // اگه جدول نبود، به روش معمولی روی متن تمیز
        const cleanText = stripHtmlTags(htmlContent);
        if (queryInfo.type === "NUMBER") {
            return searchNumberInText(cleanText, queryInfo.data, filepath, maxResults, 0);
        }
        return searchTextInText(cleanText, queryInfo.data, filepath, wholeWord, maxResults, 0);
    }
    
    // تشخیص هدر
    let header = null;
    let dataRows = rows;
    
    if (rows.length > 0) {
        const firstRow = rows[0];
        const allNonNumeric = firstRow.every(c => c && !/^\d+$/.test(c.replace(/[-.\s]/g, "")));
        if (allNonNumeric) {
            header = firstRow;
            dataRows = rows.slice(1);
        }
    }
    
    // ✅ آماده‌سازی بر اساس نوع query
    let queryNorm = null;
    let patterns = null;
    const maxLen = queryInfo.type === "NUMBER"
        ? Math.max.apply(null, queryInfo.data.map(v => v.length))
        : 0;
    
    if (queryInfo.type === "TEXT") {
        queryNorm = queryInfo.data.map(t => normalizePersian(t).toLowerCase());
        if (wholeWord) {
            patterns = queryInfo.data.map(t => {
                const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return new RegExp(`(?<![^\\s،,;:.!?])${esc}(?![^\\s،,;:.!?])`, 'iu');
            });
        }
    }
    
    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
        const cells = dataRows[rowIdx];
        const rowText = cells.join(" | ");
        let matched = false;
        
        if (queryInfo.type === "NUMBER") {
            // جستجوی عددی — چک کردن مرزهای رقم
            for (const variant of queryInfo.data) {
                const idx = rowText.indexOf(variant);
                if (idx === -1) continue;
                if (variant.length >= maxLen) {
                    const before = idx > 0 ? rowText[idx - 1] : "";
                    const after = idx + variant.length < rowText.length ? rowText[idx + variant.length] : "";
                    if (/\d/.test(before) || /\d/.test(after)) continue;
                }
                matched = true;
                break;
            }
        } else {
            // جستجوی متنی
            const rowFixed = persianFastFix(rowText).toLowerCase();
            let ok = true;
            for (const qn of queryNorm) {
                if (rowFixed.indexOf(qn) === -1) { ok = false; break; }
            }
            if (ok) {
                const rowNorm = normalizePersian(rowText).toLowerCase();
                if (wholeWord) {
                    ok = patterns.every(p => p.test(normalizePersian(rowText)));
                } else {
                    ok = queryNorm.every(qn => rowNorm.indexOf(qn) !== -1);
                }
            }
            matched = ok;
        }
        
        if (matched) {
            const ctype = detectContentType(rowText, filepath);
            results.push({
                line: rowIdx + 1,
                content: rowText,
                summary: summarizeHtmlRow(header, cells),
                content_type: ctype,
            });
            if (results.length >= maxResults) break;
        }
    }
    
    return results;
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
    // ✅ مدارس
    if (fpLower.indexOf("madare") !== -1 || fpLower.indexOf("school") !== -1 ||
        fpLower.indexOf("danesh") !== -1 || fpLower.indexOf("madrese") !== -1) {
        return "school";
    }
    if (/%?B?\d{16}\^/.test(content)) return "bank";
    if (content.indexOf('"phone"') !== -1 && content.indexOf('"first_name"') !== -1) {
        return "telegram";
    }
    return "normal";
}

// ═══════════════════════════════════════════════════════════
//  خلاصه‌سازی (غیر HTML)
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
//  جستجو در متن (غیر HTML)
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
    
    const fileName = (file.name || "").toLowerCase();
    const isHtml = HTML_EXTENSIONS.some(ext => fileName.endsWith(ext));
    
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
        let text = "";
        try {
            text = await file.text();
        } catch (e) {
            console.error("[WORKER] خطا در readAsText:", e);
            return;
        }
        if (!text) return;
        
        let results;
        
        if (isHtml) {
            // ✅ HTML → پارس جدول
            results = searchHtmlContent(text, queryInfo, wholeWord, maxResults, filePath);
        } else if (queryInfo.type === "NUMBER") {
            results = searchNumberInText(text, queryInfo.data, filePath, maxResults, 0);
        } else {
            results = searchTextInText(text, queryInfo.data, filePath, wholeWord, maxResults, 0);
        }
        
        processResults(results);
        flushBatch();
        return;
    }
    
    // فایل بزرگ — chunk based
    let offset = 0;
    let lineOffset = 0;
    let leftover = "";
    
    // ✅ برای HTML بزرگ، کل رو توی حافظه می‌خونیم اگه < 200MB
    if (isHtml && size < 200 * 1024 * 1024) {
        let fullText = "";
        try {
            fullText = await file.text();
        } catch (e) {
            console.error("[WORKER] خطا در خواندن HTML بزرگ:", e);
            return;
        }
        const results = searchHtmlContent(fullText, queryInfo, wholeWord, maxResults, filePath);
        processResults(results);
        flushBatch();
        return;
    }
    
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
        
        if (isHtml) {
            const cleanChunk = stripHtmlTags(chunkText);
            if (queryInfo.type === "NUMBER") {
                chunkResults = searchNumberInText(cleanChunk, queryInfo.data, filePath, remaining, lineOffset);
            } else {
                chunkResults = searchTextInText(cleanChunk, queryInfo.data, filePath, wholeWord, remaining, lineOffset);
            }
        } else if (queryInfo.type === "NUMBER") {
            chunkResults = searchNumberInText(chunkText, queryInfo.data, filePath, remaining, lineOffset);
        } else {
            chunkResults = searchTextInText(chunkText, queryInfo.data, filePath, wholeWord, remaining, lineOffset);
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
    
    if (msg.action !== "search") return;
    
    const file = msg.file;
    const query = msg.query;
    const wholeWord = msg.wholeWord;
    const maxResults = msg.maxResults;
    const fileIndex = msg.fileIndex;
    const totalFiles = msg.totalFiles;
    const filePath = msg.filePath;
    
    let queryInfo;
    try {
        queryInfo = prepareQuery(query);
    } catch (e) {
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