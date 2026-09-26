package com.razatech.diffsense.engine

import java.math.BigDecimal

/**
 * A strict JSON parser with `JSON.parse` semantics (no comments, no trailing commas). Objects become
 * insertion-ordered maps, numbers become [BigDecimal]. Written by hand so the engine has no dependency on
 * whichever JSON library the host IDE happens to ship.
 */
class JsonParser private constructor(private val s: String) {
    private var i = 0

    companion object {
        /** @throws ParseError when [text] is not valid JSON. */
        fun parse(text: String): Any? {
            val p = JsonParser(text)
            p.skipWs()
            val v = p.value()
            p.skipWs()
            if (p.i < text.length) p.fail("Unexpected token")
            return v
        }
    }

    private fun fail(msg: String): Nothing = throw ParseError("$msg at position $i")

    private fun skipWs() {
        while (i < s.length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++
    }

    private fun value(): Any? {
        if (i >= s.length) fail("Unexpected end of JSON input")
        return when (val c = s[i]) {
            '{' -> obj()
            '[' -> arr()
            '"' -> str()
            't' -> literal("true", true)
            'f' -> literal("false", false)
            'n' -> literal("null", null)
            else -> if (c == '-' || c in '0'..'9') num() else fail("Unexpected token '$c'")
        }
    }

    private fun literal(word: String, v: Any?): Any? {
        if (!s.startsWith(word, i)) fail("Unexpected token")
        i += word.length
        return v
    }

    private fun obj(): Map<String, Any?> {
        val m = LinkedHashMap<String, Any?>()
        i++ // {
        skipWs()
        if (i < s.length && s[i] == '}') { i++; return m }
        while (true) {
            skipWs()
            if (i >= s.length || s[i] != '"') fail("Expected property name")
            val k = str()
            skipWs()
            if (i >= s.length || s[i] != ':') fail("Expected ':'")
            i++
            skipWs()
            m[k] = value()
            skipWs()
            if (i >= s.length) fail("Unexpected end of JSON input")
            if (s[i] == ',') { i++; continue }
            if (s[i] == '}') { i++; return m }
            fail("Expected ',' or '}'")
        }
    }

    private fun arr(): List<Any?> {
        val l = ArrayList<Any?>()
        i++ // [
        skipWs()
        if (i < s.length && s[i] == ']') { i++; return l }
        while (true) {
            skipWs()
            l.add(value())
            skipWs()
            if (i >= s.length) fail("Unexpected end of JSON input")
            if (s[i] == ',') { i++; continue }
            if (s[i] == ']') { i++; return l }
            fail("Expected ',' or ']'")
        }
    }

    private fun str(): String {
        i++ // opening quote
        val sb = StringBuilder()
        while (true) {
            if (i >= s.length) fail("Unterminated string")
            val c = s[i++]
            when {
                c == '"' -> return sb.toString()
                c < ' ' -> { i--; fail("Bad control character in string") }
                c == '\\' -> {
                    if (i >= s.length) fail("Unterminated string")
                    when (val e = s[i++]) {
                        '"' -> sb.append('"')
                        '\\' -> sb.append('\\')
                        '/' -> sb.append('/')
                        'b' -> sb.append('\b')
                        'f' -> sb.append('\u000C')
                        'n' -> sb.append('\n')
                        'r' -> sb.append('\r')
                        't' -> sb.append('\t')
                        'u' -> {
                            if (i + 4 > s.length) fail("Bad Unicode escape")
                            val hex = s.substring(i, i + 4)
                            if (!hex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) fail("Bad Unicode escape")
                            sb.append(hex.toInt(16).toChar())
                            i += 4
                        }
                        else -> { i--; fail("Bad escaped character '$e'") }
                    }
                }
                else -> sb.append(c)
            }
        }
    }

    private fun num(): BigDecimal {
        val start = i
        if (s[i] == '-') i++
        if (i >= s.length) fail("No number after minus sign")
        if (s[i] == '0') i++
        else if (s[i] in '1'..'9') while (i < s.length && s[i] in '0'..'9') i++
        else fail("No number after minus sign")
        if (i < s.length && s[i] == '.') {
            i++
            val d = i
            while (i < s.length && s[i] in '0'..'9') i++
            if (i == d) fail("Unterminated fractional number")
        }
        if (i < s.length && (s[i] == 'e' || s[i] == 'E')) {
            i++
            if (i < s.length && (s[i] == '+' || s[i] == '-')) i++
            val d = i
            while (i < s.length && s[i] in '0'..'9') i++
            if (i == d) fail("Exponent part is missing a number")
        }
        return BigDecimal(s.substring(start, i))
    }
}
