package com.razatech.diffsense.engine

import java.io.StringReader
import javax.xml.stream.XMLInputFactory
import javax.xml.stream.XMLStreamConstants
import javax.xml.stream.XMLStreamException

private class XNode(val name: String, val attrs: List<Pair<String, String>>) {
    /** Either a [String] (text) or an [XNode]. */
    val children = ArrayList<Any>()
}

private fun stripPrefix(name: String) = name.substring(name.indexOf(':') + 1)

private val DECLARATION = Regex("^\\s*<\\?xml\\b([^?]*)\\?>")
private val DECLARATION_ATTR = Regex("([\\w:.-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')")

private fun readTree(content: String, name: String): XNode {
    // The JDK's own StAX implementation, with DTDs and external entities switched off (no XXE).
    val factory = XMLInputFactory.newDefaultFactory()
    factory.setProperty(XMLInputFactory.IS_NAMESPACE_AWARE, false)
    factory.setProperty(XMLInputFactory.SUPPORT_DTD, false)
    factory.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false)
    factory.setProperty(XMLInputFactory.IS_REPLACING_ENTITY_REFERENCES, true)
    var root: XNode? = null
    val stack = ArrayList<XNode>()
    try {
        val r = factory.createXMLStreamReader(StringReader(content))
        while (r.hasNext()) {
            when (r.next()) {
                XMLStreamConstants.START_ELEMENT -> {
                    val attrs = (0 until r.attributeCount).map { i ->
                        val an = r.getAttributeName(i)
                        (if (an.prefix.isNullOrEmpty()) an.localPart else "${an.prefix}:${an.localPart}") to r.getAttributeValue(i)
                    }
                    val en = r.name
                    val node = XNode(if (en.prefix.isNullOrEmpty()) en.localPart else "${en.prefix}:${en.localPart}", attrs)
                    if (stack.isNotEmpty()) stack.last().children.add(node)
                    else if (root == null) root = node
                    stack.add(node)
                }
                XMLStreamConstants.END_ELEMENT -> stack.removeAt(stack.size - 1)
                XMLStreamConstants.CHARACTERS, XMLStreamConstants.CDATA, XMLStreamConstants.SPACE -> {
                    if (stack.isNotEmpty()) stack.last().children.add(r.text)
                }
            }
        }
    } catch (e: XMLStreamException) {
        throw ParseError("$name: ${e.message?.lineSequence()?.lastOrNull { it.isNotBlank() } ?: "invalid XML"}")
    }
    return root ?: throw ParseError("$name: no root element")
}

/**
 * Converts XML into a plain value tree so the shared structural differ can be reused: attributes become
 * `@name`, mixed text `#text`, repeated sibling elements a list, and a leaf element without attributes just
 * its text. Paths therefore read like `user.age`, `item[1].name`, `user.@id`.
 * Comments are ignored; CDATA is treated as text.
 */
@Suppress("UNCHECKED_CAST")
internal fun parseXml(input: FileInput, o: CompareOptions): Any? {
    val content = input.content.removePrefix("\uFEFF")
    val root = readTree(content, input.name)
    val skip = (o.ignoreAttributes ?: emptyList()).toSet()
    val ignoreNs = o.ignoreNamespaces == true
    val nameOf = { n: String -> if (ignoreNs) stripPrefix(n) else n }

    fun attrsOf(raw: List<Pair<String, String>>): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for ((k, v) in raw) {
            if (ignoreNs && (k == "xmlns" || k.startsWith("xmlns:"))) continue
            val n = nameOf(k)
            if (k in skip || n in skip) continue
            out["@$n"] = v
        }
        return out
    }

    fun convert(children: List<Any>, attrs: Map<String, String>): Any? {
        val out = LinkedHashMap<String, Any?>(attrs)
        val counts = HashMap<String, Int>()
        val elements = ArrayList<Pair<String, Any?>>()
        val text = StringBuilder()
        for (child in children) {
            if (child is String) text.append(child)
            else {
                child as XNode
                val tag = nameOf(child.name)
                elements.add(tag to convert(child.children, attrsOf(child.attrs)))
                counts[tag] = (counts[tag] ?: 0) + 1
            }
        }
        var t = text.toString()
        if (elements.isNotEmpty() && jsTrim(t).isEmpty()) t = ""
        if (t.isNotEmpty()) out["#text"] = t
        for ((tag, value) in elements) {
            if (counts[tag]!! > 1) (out.getOrPut(tag) { ArrayList<Any?>() } as MutableList<Any?>).add(value)
            else out[tag] = value
        }
        if (out.isEmpty()) return ""
        return if (out.size == 1 && out.containsKey("#text")) out["#text"] else out
    }

    val result = LinkedHashMap<String, Any?>()
    if (o.ignoreXmlDeclaration != true) {
        DECLARATION.find(content)?.let { m ->
            val decl = DECLARATION_ATTR.findAll(m.groupValues[1]).map { a ->
                a.groupValues[1] to (a.groups[2]?.value ?: a.groups[3]?.value ?: "")
            }.toList()
            result["?xml"] = attrsOf(decl)
        }
    }
    result[nameOf(root.name)] = convert(root.children, attrsOf(root.attrs))
    return result
}

internal fun compareXml(left: FileInput, right: FileInput, options: CompareOptions): ComparisonResult {
    val changes = diffValues(parseXml(left, options), parseXml(right, options), options)
    return ComparisonResult(Format.XML, left.name, right.name, changes, computeStats(changes), null, emptyList())
}
