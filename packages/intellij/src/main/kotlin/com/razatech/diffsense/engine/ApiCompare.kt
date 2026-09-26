package com.razatech.diffsense.engine

import java.math.BigDecimal

/** Headers that differ on every request and are never worth comparing. */
private val VOLATILE_HEADERS = setOf(
    "date", "server", "connection", "keep-alive", "content-length", "transfer-encoding", "age", "via",
    "x-request-id", "x-correlation-id", "x-trace-id", "x-amzn-trace-id", "x-cloud-trace-context",
)

internal class ParsedResponse(val status: Int?, val headers: Map<String, String>, val body: Any?)

private sealed interface Attempt
private class Ok(val value: Any?) : Attempt
private object Fail : Attempt

private fun tryJson(s: String): Attempt = try {
    Ok(JsonParser.parse(s))
} catch (e: ParseError) {
    Fail
}

@Suppress("UNCHECKED_CAST")
private fun lowerHeaders(h: Any?): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    if (h is Map<*, *>) {
        val m = h as Map<String, Any?>
        for (k in orderedKeys(m)) out[k.lowercase()] = jsString(m[k])
    }
    return out
}

private val STATUS_LINE = Regex("^HTTP/[\\d.]+\\s+(\\d{3})[^\\n]*\\r?\\n")
private val BLANK_LINE = Regex("\\r?\\n\\r?\\n")

/**
 * Accepts, in order of detection:
 *  1. a raw HTTP response (`HTTP/1.1 200 OK`, headers, blank line, body)
 *  2. a JSON envelope `{ status | statusCode, headers?, body | data }`
 *  3. anything else, treated as just the body (JSON if it parses, else text)
 */
@Suppress("UNCHECKED_CAST")
internal fun parseApiResponse(input: FileInput): ParsedResponse {
    val text = input.content.removePrefix("\uFEFF")

    val m = STATUS_LINE.find(text)
    if (m != null) {
        val rest = text.substring(m.value.length)
        val noHeaders = Regex("^\\r?\\n").find(rest)
        val split = if (noHeaders != null) null else BLANK_LINE.find(rest)
        val headText = if (noHeaders != null) "" else if (split != null) rest.substring(0, split.range.first) else rest
        val bodyText = if (noHeaders != null) rest.substring(noHeaders.value.length)
        else if (split != null) rest.substring(split.range.last + 1) else ""
        val headers = LinkedHashMap<String, String>()
        for (line in headText.split(Regex("\\r?\\n"))) {
            val i = line.indexOf(':')
            if (i > 0) headers[jsTrim(line.substring(0, i)).lowercase()] = jsTrim(line.substring(i + 1))
        }
        val j = tryJson(jsTrim(bodyText))
        return ParsedResponse(m.groupValues[1].toInt(), headers, if (j is Ok) j.value else jsTrim(bodyText))
    }

    val j = tryJson(jsTrim(text))
    if (j is Ok && j.value is Map<*, *>) {
        val v = j.value as Map<String, Any?>
        val st = v["status"]
        val sc = v["statusCode"]
        val status: Int? = when {
            st is Number -> st.toInt()
            sc is Number -> sc.toInt()
            else -> null
        }
        val hasBodyKey = v.containsKey("body") || v.containsKey("data")
        if (status != null && (hasBodyKey || v.containsKey("headers"))) {
            var body: Any? = when {
                v.containsKey("body") -> v["body"]
                v.containsKey("data") -> v["data"]
                else -> Absent
            }
            if (body is String) {
                val inner = tryJson(body)
                if (inner is Ok) body = inner.value
            }
            return ParsedResponse(status, lowerHeaders(v["headers"]), body)
        }
    }
    return ParsedResponse(null, emptyMap(), if (j is Ok) j.value else jsTrim(text))
}

private fun show(v: Any?): String? = if (v is String) v else jsStringify(v)

/**
 * Expected (left) vs actual (right). A "mismatch" is anything that is not unchanged: a differing value, a
 * field missing from the actual response or (unless `ignoreExtraFields`) an unexpected extra field.
 */
internal fun compareApi(expected: FileInput, actual: FileInput, options: CompareOptions): ComparisonResult {
    val e = parseApiResponse(expected)
    val a = parseApiResponse(actual)
    val changes = ArrayList<Change>()
    val warnings = ArrayList<String>()

    if (e.status != null && a.status != null) {
        val es = BigDecimal(e.status)
        val bs = BigDecimal(a.status)
        changes.add(
            if (e.status == a.status) Change("status", ChangeKind.UNCHANGED, es, bs)
            else Change(
                "status", ChangeKind.MODIFIED, es, bs, impact = Impact.HIGH,
                reason = "Status code differs; the response class (success vs error) may have changed.",
            ),
        )
    } else if (e.status != null || a.status != null) {
        warnings.add("Status code is present in only one input, so it was not compared.")
    }

    val skip = VOLATILE_HEADERS + (options.ignoreHeaders ?: emptyList()).map { it.lowercase() }
    for ((name, ev) in e.headers) {
        if (name in skip) continue
        val av = a.headers[name]
        val path = "headers.$name"
        changes.add(
            when {
                av == null -> Change(path, ChangeKind.REMOVED, before = ev)
                av == ev -> Change(path, ChangeKind.UNCHANGED, ev, av)
                else -> Change(path, ChangeKind.MODIFIED, ev, av)
            },
        )
    }

    val composite = { v: Any? -> v is Map<*, *> || v is List<*> }
    if (composite(e.body) && composite(a.body)) {
        for (c in diffValues(e.body, a.body, options)) {
            if (c.kind == ChangeKind.ADDED && options.ignoreExtraFields == true) continue
            changes.add(c.copy(path = if (c.path == "$") "body" else "body.${c.path}"))
        }
    } else if (e.body !== Absent || a.body !== Absent) {
        val same = show(e.body) == show(a.body)
        changes.add(Change("body", if (same) ChangeKind.UNCHANGED else ChangeKind.MODIFIED, e.body, a.body))
    }

    return ComparisonResult(Format.API, expected.name, actual.name, changes, computeStats(changes), null, warnings)
}

/** Number of things that do not match the expectation. */
fun apiMismatches(r: ComparisonResult): Int = r.stats.added + r.stats.removed + r.stats.modified
