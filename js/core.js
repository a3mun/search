/* ============================================================
   Search of Sky — Core Logic (JavaScript)
   توابع مشترک (نرمال‌سازی + خلاصه‌سازی)
   ============================================================ */

(function() {
    'use strict';
    
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
    
    const FAST_EXTENSIONS = [
        ".txt", ".log", ".nfo", ".text",
        ".csv", ".tsv", ".tab",
        ".json", ".xml", ".yaml", ".yml",
        ".htm", ".html", ".xhtml",
        ".md", ".rst", ".ini", ".cfg", ".conf",
        ".sql", ".dat", ".rtf",
    ];
    
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
    
    function prepareQuery(query) {
        query = (query || "").trim();
        const q = (function(text) {
            let r = normalizeDigits(text);
            for (const ch of [" ", "-", "_", ".", "(", ")", "\t"]) {
                r = r.split(ch).join("");
            }
            return r;
        })(query);
        
        if (q.length > 0 && /^\d+$/.test(q)) {
            // NUMBER
            let qq = q.replace(/^\+/, "");
            if (qq.startsWith("00")) qq = qq.slice(2);
            
            const variants = new Set();
            const isMobile = (qq.length === 10 && qq.startsWith("9")) ||
                             (qq.length === 11 && qq.startsWith("09")) ||
                             (qq.length === 12 && qq.startsWith("989")) ||
                             (qq.length === 14 && qq.startsWith("00989"));
            
            if (!isMobile) {
                variants.add(qq);
                if (qq.startsWith("0")) variants.add(qq.slice(1));
                else variants.add("0" + qq);
            } else {
                variants.add(qq);
                if (qq.startsWith("98") && qq.length > 10) {
                    const core = qq.slice(2);
                    variants.add(core);
                    variants.add("0" + core);
                } else if (qq.startsWith("0")) {
                    const core = qq.slice(1);
                    variants.add(core);
                    variants.add("98" + core);
                } else if (qq.length === 10) {
                    variants.add("0" + qq);
                    variants.add("98" + qq);
                }
            }
            return { type: "NUMBER", data: Array.from(variants).sort((a, b) => a.length - b.length) };
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
    
    function extractSummary(content) {
        // Telegram
        if (content.indexOf('"phone"') !== -1 || content.indexOf('"first_name"') !== -1) {
            const get = (name) => {
                const re = new RegExp('\\\\?"' + name + '\\\\?":\\\\?"([^"\\\\]+)\\\\?"');
                const m = content.match(re);
                return m ? m[1].trim() : "";
            };
            const first = get("first_name");
            const last = get("last_name");
            const phone = get("phone");
            const username = get("username");
            const idMatch = content.match(/\\?"id\\?":(\d+)/);
            const id = idMatch ? idMatch[1] : "";
            
            if (first || last || phone || id) {
                const parts = [];
                if (first || last) parts.push(`👤 ${(first + " " + last).trim()}`);
                if (phone) parts.push(`📞 ${phone}`);
                if (username) parts.push(`@${username}`);
                if (id) parts.push(`🆔 ${id}`);
                if (username) parts.push(`🔗 https://t.me/${username}`);
                else if (id) parts.push(`🔗 tg://user?id=${id}`);
                return parts.join("  •  ");
            }
        }
        
        // Track2
        const track2 = content.match(/%?B?(\d{16})\^([^^]*)\^/);
        if (track2) {
            const parts = [`💳 ${track2[1]}`];
            if (track2[2].trim()) parts.push(`👤 ${track2[2].trim()}`);
            return parts.join("  •  ");
        }
        
        const stripped = content.trim();
        if (stripped.length < 5) return stripped;
        if (stripped.length <= 120) return stripped;
        return "";
    }
    
    window.SS_CORE = {
        normalizePersian,
        normalizeDigits,
        prepareQuery,
        extractSummary,
        FAST_EXTENSIONS,
    };
    
})();