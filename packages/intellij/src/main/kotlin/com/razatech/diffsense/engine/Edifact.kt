package com.razatech.diffsense.engine

class EdifactSegment(
    val tag: String,
    /** Data elements after the tag; each is a list of components. */
    val elements: List<List<String>>,
    /** The segment exactly as written (terminator excluded, line breaks removed). */
    val raw: String,
)

class EdifactDocument(val una: String?, val segments: List<EdifactSegment>)

private val EDIFACT_START = Regex("^\\s*(UNA.{6}\\s*)?UNB\\+")

/** True when the text looks like an EDIFACT interchange (starts with UNA or UNB). */
fun looksLikeEdifact(content: String): Boolean = EDIFACT_START.containsMatchIn(content.removePrefix("﻿"))

/**
 * Parses an EDIFACT interchange. Delimiters come from the `UNA` header when present. Line breaks are not
 * significant (files arrive as one line or one segment per line), unless escaped with the release character.
 */
fun parseEdifact(input: FileInput): EdifactDocument {
    var text = input.content.removePrefix("﻿").trimStart()
    var component = ':'
    var element = '+'
    var release = '?'
    var terminator = '\''
    var una: String? = null
    if (text.startsWith("UNA")) {
        if (text.length < 9) throw ParseError("${input.name}: truncated UNA service string advice")
        una = text.substring(0, 9)
        component = una[3]
        element = una[4]
        release = una[6]
        terminator = una[8]
        text = text.substring(9)
    }

    val segments = ArrayList<EdifactSegment>()
    val raw = StringBuilder()
    var elements = ArrayList<ArrayList<String>>().apply { add(ArrayList()) }
    val value = StringBuilder()
    fun endComponent() {
        elements.last().add(value.toString())
        value.setLength(0)
    }
    fun endSegment() {
        endComponent()
        val tag = elements[0][0].trim()
        if (!Regex("^[A-Z]{3}$").matches(tag)) {
            throw ParseError("${input.name}: \"${tag.take(12)}\" is not a valid segment tag")
        }
        segments.add(EdifactSegment(tag, elements.drop(1), raw.toString().trim()))
        raw.setLength(0)
        elements = ArrayList<ArrayList<String>>().apply { add(ArrayList()) }
    }

    var i = 0
    while (i < text.length) {
        val ch = text[i]
        if (ch == release && i + 1 < text.length) {
            i++
            value.append(text[i])
            raw.append(ch).append(text[i])
        } else if (ch == '\r' || ch == '\n') {
            // not significant
        } else if (ch == terminator) {
            endSegment()
        } else {
            raw.append(ch)
            if (ch == element) {
                endComponent()
                elements.add(ArrayList())
            } else if (ch == component) endComponent()
            else value.append(ch)
        }
        i++
    }
    if (raw.toString().isNotBlank() || value.toString().isNotBlank()) {
        throw ParseError("${input.name}: last segment is not terminated with $terminator")
    }
    if (segments.isEmpty()) throw ParseError("${input.name}: no EDIFACT segments found")
    return EdifactDocument(una, segments)
}

/** One segment per line, keeping the file's own delimiters. */
fun formatEdifact(input: FileInput): String {
    val doc = parseEdifact(input)
    val term = doc.una?.get(8) ?: '\''
    val lines = doc.segments.map { it.raw + term }
    return (listOfNotNull(doc.una) + lines).joinToString("\n") + "\n"
}

/** Segments identified by tag plus qualifier (`NAD+BY` is `NAD[BY]`) so inserts do not shift neighbours. */
private val QUALIFIED = setOf(
    "NAD", "LOC", "DTM", "RFF", "MEA", "FTX", "DOC", "TDT", "CNI", "QTY", "MOA", "PRI", "CUX", "PIA", "IMD",
    "GIN", "PCI", "EQD", "SEL", "TMD", "TOD", "PAT", "PAC", "DGS", "CTA", "COM", "ALI", "FII", "LIN", "TAX", "ALC",
)

/** Segments that open a group; the segments after them are keyed within it (`LIN[1]/QTY[21]`). */
private val SCOPE_OPEN = setOf("LIN")
private val SCOPE_CLOSE = setOf("UNS", "UNH", "UNT")

private fun keyed(doc: EdifactDocument): LinkedHashMap<String, EdifactSegment> {
    val out = LinkedHashMap<String, EdifactSegment>()
    var scope = ""
    for (s in doc.segments) {
        val q = if (s.tag in QUALIFIED) s.elements.getOrNull(0)?.getOrNull(0) else null
        // MEA repeats under one qualifier (AAE) and is told apart by the dimension (G, L, W, H).
        val q2 = if (s.tag == "MEA") s.elements.getOrNull(1)?.getOrNull(0) else null
        val key = if (!q.isNullOrEmpty()) "${s.tag}[${if (!q2.isNullOrEmpty()) "$q,$q2" else q}]" else s.tag
        if (s.tag in SCOPE_CLOSE) scope = ""
        val full = if (s.tag in SCOPE_OPEN) key else scope + key
        var unique = full
        var n = 2
        while (out.containsKey(unique)) unique = "$full#${n++}"
        out[unique] = s
        if (s.tag in SCOPE_OPEN) scope = "$unique/"
    }
    return out
}

private class EdifactRule(val impact: Impact, val reason: String)

private val ENVELOPE = EdifactRule(Impact.INFORMATIONAL, "Envelope metadata or control total; normally differs on every transmission.")
private val BY_TAG: Map<String, EdifactRule> = mapOf(
    "NAD" to EdifactRule(Impact.HIGH, "A party (buyer, carrier, consignee...) changed; the document may go to or concern a different business partner."),
    "CTA" to EdifactRule(Impact.MEDIUM, "Contact details changed."),
    "FII" to EdifactRule(Impact.HIGH, "Financial institution or account changed."),
    "LOC" to EdifactRule(Impact.HIGH, "A location (port, place, country) changed; routing or delivery may differ."),
    "TDT" to EdifactRule(Impact.HIGH, "Transport details (mode, carrier, vessel) changed."),
    "MOA" to EdifactRule(Impact.HIGH, "A monetary amount changed."),
    "PRI" to EdifactRule(Impact.HIGH, "A price changed."),
    "CUX" to EdifactRule(Impact.HIGH, "Currency or exchange rate changed."),
    "PAT" to EdifactRule(Impact.HIGH, "Payment terms changed."),
    "TAX" to EdifactRule(Impact.HIGH, "Tax details changed."),
    "ALC" to EdifactRule(Impact.MEDIUM, "Allowance or charge changed."),
    "QTY" to EdifactRule(Impact.MEDIUM, "A quantity changed."),
    "MEA" to EdifactRule(Impact.MEDIUM, "A measurement (weight, volume...) changed."),
    "EQD" to EdifactRule(Impact.MEDIUM, "Equipment details changed."),
    "PAC" to EdifactRule(Impact.MEDIUM, "Packaging details changed."),
    "GIN" to EdifactRule(Impact.MEDIUM, "Goods identity numbers changed."),
    "SEL" to EdifactRule(Impact.MEDIUM, "Seal numbers changed."),
    "DGS" to EdifactRule(Impact.HIGH, "Dangerous goods information changed."),
    "BGM" to EdifactRule(Impact.MEDIUM, "Document type or number changed."),
    "RFF" to EdifactRule(Impact.MEDIUM, "A reference number changed."),
    "DOC" to EdifactRule(Impact.MEDIUM, "A document reference changed."),
    "DTM" to EdifactRule(Impact.MEDIUM, "A date or time changed."),
    "LIN" to EdifactRule(Impact.MEDIUM, "A line item changed."),
    "PIA" to EdifactRule(Impact.MEDIUM, "Product identification changed."),
    "FTX" to EdifactRule(Impact.LOW, "Free text changed."),
    "IMD" to EdifactRule(Impact.LOW, "Item description changed."),
    "COM" to EdifactRule(Impact.LOW, "Communication contact changed."),
)
private val EDIFACT_FALLBACK = EdifactRule(Impact.LOW, "No known business meaning for this segment; likely descriptive.")

private fun ruleFor(tag: String, element: Int?): EdifactRule = when (tag) {
    "UNZ", "UNT" -> ENVELOPE
    "UNB" -> if (element == 1 || element == 2) EdifactRule(Impact.HIGH, "Interchange sender or recipient changed; routing may differ.") else ENVELOPE
    "UNH" -> if (element == 1) EdifactRule(Impact.HIGH, "Message type or version changed.") else ENVELOPE
    else -> BY_TAG[tag] ?: EDIFACT_FALLBACK
}

private fun norm(v: String?, o: CompareOptions): String {
    var s = v ?: ""
    if (o.ignoreWhitespace == true) s = s.trim().replace(Regex("\\s+"), " ")
    if (o.ignoreCase == true) s = s.lowercase()
    return s
}

private fun same(a: String?, b: String?, o: CompareOptions): Boolean {
    val x = norm(a, o)
    val y = norm(b, o)
    if (x == y) return true
    if (o.numericEquality == true && x.isNotEmpty() && y.isNotEmpty()) {
        val m = x.trim().replaceFirst(',', '.').toDoubleOrNull()
        val n = y.trim().replaceFirst(',', '.').toDoubleOrNull()
        return m != null && n != null && m == n
    }
    return false
}

private fun maxMedium(i: Impact) = if (i == Impact.LOW || i == Impact.INFORMATIONAL) Impact.MEDIUM else i

internal fun compareEdifact(left: FileInput, right: FileInput, options: CompareOptions): ComparisonResult {
    val a = keyed(parseEdifact(left))
    val b = keyed(parseEdifact(right))
    val ignores = compileGlobs(options.ignorePaths)
    val changes = ArrayList<Change>()
    fun emit(c: Change) {
        if (!matchesAny(c.path, ignores)) changes.add(c)
    }

    val keys = a.keys + b.keys.filter { !a.containsKey(it) }
    for (key in keys) {
        val l = a[key]
        val r = b[key]
        val tag = (l ?: r)!!.tag
        if (l == null || r == null) {
            val rule = ruleFor(tag, null)
            val impact = if (rule.impact == Impact.INFORMATIONAL) rule.impact else maxMedium(rule.impact)
            emit(
                Change(
                    path = key,
                    kind = if (l != null) ChangeKind.REMOVED else ChangeKind.ADDED,
                    before = if (l != null) l.raw else Absent,
                    after = if (l != null) Absent else r!!.raw,
                    evidence = "fact",
                    impact = impact,
                    reason = "Segment ${if (l != null) "removed" else "added"}. ${rule.reason}",
                ),
            )
            continue
        }
        val n = maxOf(l.elements.size, r.elements.size)
        for (e in 0 until n) {
            val le = l.elements.getOrElse(e) { emptyList() }
            val re = r.elements.getOrElse(e) { emptyList() }
            val composite = le.size > 1 || re.size > 1
            val m = if (composite) maxOf(le.size, re.size) else 1
            for (c in 0 until m) {
                val before = le.getOrNull(c)
                val after = re.getOrNull(c)
                if ((before ?: "").isEmpty() && (after ?: "").isEmpty()) continue
                val path = if (composite) "$key.${e + 1}.${c + 1}" else "$key.${e + 1}"
                if (same(before, after, options)) {
                    emit(Change(path, ChangeKind.UNCHANGED, before ?: Absent, after ?: Absent, "fact"))
                    continue
                }
                val rule = ruleFor(tag, e)
                val empty = (before ?: "").isEmpty()
                val gone = (after ?: "").isEmpty()
                emit(
                    Change(
                        path = path,
                        kind = if (empty) ChangeKind.ADDED else if (gone) ChangeKind.REMOVED else ChangeKind.MODIFIED,
                        before = if (empty) Absent else before,
                        after = if (gone) Absent else after,
                        evidence = "fact",
                        impact = rule.impact,
                        reason = rule.reason,
                    ),
                )
            }
        }
    }
    return ComparisonResult(Format.EDIFACT, left.name, right.name, changes, computeStats(changes), null, emptyList())
}
