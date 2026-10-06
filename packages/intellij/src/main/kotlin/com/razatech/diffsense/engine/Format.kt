package com.razatech.diffsense.engine

/** Formats the plugin can reformat. YAML is left to the IDE's own Reformat Code, which keeps comments. */
val FORMATTABLE: List<Format> = listOf(Format.JSON, Format.XML, Format.EDIFACT)

/** Re-indents JSON without touching values: strings, numbers and key order are kept exactly. */
private fun formatJson(input: FileInput, indent: Int): String {
    val src = input.content.removePrefix("﻿")
    try {
        JsonParser.parse(src)
    } catch (e: ParseError) {
        throw ParseError("${input.name}: invalid JSON (${e.message})")
    }
    val out = StringBuilder()
    var depth = 0
    var i = 0
    fun pad(n: Int) = " ".repeat(indent * n)
    fun skipWs(from: Int): Int {
        var j = from
        while (j < src.length && src[j].isWhitespace()) j++
        return j
    }
    while (i < src.length) {
        val ch = src[i]
        when {
            ch.isWhitespace() -> i++
            ch == '"' -> {
                var j = i + 1
                while (src[j] != '"') j += if (src[j] == '\\') 2 else 1
                out.append(src, i, j + 1)
                i = j + 1
            }
            ch == '{' || ch == '[' -> {
                val next = skipWs(i + 1)
                if (next < src.length && src[next] == (if (ch == '{') '}' else ']')) {
                    out.append(ch).append(src[next])
                    i = next + 1
                } else {
                    depth++
                    out.append(ch).append('\n').append(pad(depth))
                    i++
                }
            }
            ch == '}' || ch == ']' -> {
                depth--
                out.append('\n').append(pad(depth)).append(ch)
                i++
            }
            ch == ',' -> {
                out.append(",\n").append(pad(depth))
                i++
            }
            ch == ':' -> {
                out.append(": ")
                i++
            }
            else -> {
                var j = i
                while (j < src.length && !(src[j].isWhitespace() || src[j] in ",]}:")) j++
                out.append(src, i, j)
                i = j
            }
        }
    }
    return out.append('\n').toString()
}

private class FmtNode(val kind: String, val open: String) {
    val children = ArrayList<FmtNode>()
    var close: String? = null
    var inner: String? = null
    var selfClosing = false
}

private val XML_TOKEN = Regex(
    """<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^>\[]|\[[\s\S]*?\])*>|</[^>]+>|<(?:[^>"']|"[^"]*"|'[^']*')+>|[^<]+""",
)

/**
 * Re-indents XML. Element content is only re-flowed between elements: text is never trimmed or re-wrapped,
 * so an element that holds text keeps its content exactly as written.
 */
private fun formatXml(input: FileInput, indent: Int): String {
    val src = input.content.removePrefix("﻿")
    try {
        validateXml(src, input.name)
    } catch (e: ParseError) {
        throw ParseError("${input.name}: invalid XML (${e.message})")
    }

    val root = FmtNode("el", "")
    val stack = ArrayList<Pair<FmtNode, Int>>().apply { add(root to 0) }
    for (m in XML_TOKEN.findAll(src)) {
        val tok = m.value
        val top = stack.last()
        if (tok.startsWith("</")) {
            top.first.inner = src.substring(top.second, m.range.first)
            top.first.close = tok
            stack.removeAt(stack.size - 1)
        } else if (tok.startsWith("<") && !Regex("^<(!|\\?)").containsMatchIn(tok)) {
            val node = FmtNode("el", tok).apply { selfClosing = tok.endsWith("/>") }
            top.first.children.add(node)
            if (!node.selfClosing) stack.add(node to m.range.first + tok.length)
        } else {
            top.first.children.add(FmtNode(if (tok.startsWith("<")) "misc" else "text", tok))
        }
    }

    val lines = ArrayList<String>()
    fun emit(n: FmtNode, depth: Int) {
        val pad = " ".repeat(indent * depth)
        if (n.kind == "misc") { lines.add(pad + n.open); return }
        if (n.kind == "text") return
        if (n.selfClosing) { lines.add(pad + n.open); return }
        val hasText = n.children.any { (it.kind == "text" && it.open.isNotBlank()) || it.open.startsWith("<![CDATA[") }
        val kids = n.children.filter { !(it.kind == "text" && it.open.isBlank()) }
        if (hasText || kids.isEmpty()) {
            val inner = if (kids.isEmpty()) "" else n.inner!!
            lines.add(pad + n.open + inner + n.close!!)
            return
        }
        lines.add(pad + n.open)
        for (c in kids) emit(c, depth + 1)
        lines.add(pad + n.close!!)
    }
    for (c in root.children) emit(c, 0)
    return lines.joinToString("\n") + "\n"
}

/**
 * Reformats a file for readability: indented JSON/XML, or one EDIFACT segment per line. Throws a
 * [ParseError] when the content is not valid for its format (nothing is guessed or repaired).
 */
fun formatContent(input: FileInput, indent: Int = 2, format: Format? = null): String {
    var f = format ?: detectFormat(input.name)
    if (f == Format.TEXT && format == null && looksLikeEdifact(input.content)) f = Format.EDIFACT
    return when (f) {
        Format.JSON -> formatJson(input, indent)
        Format.XML -> formatXml(input, indent)
        Format.EDIFACT -> formatEdifact(input)
        Format.YAML -> throw ParseError("${input.name}: YAML is formatted by the IDE itself (Code | Reformat Code), which keeps comments")
        else -> throw ParseError("${input.name}: formatting supports ${FORMATTABLE.joinToString(", ") { it.id }} files")
    }
}
