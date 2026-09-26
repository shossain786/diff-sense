package com.razatech.diffsense.engine

/**
 * Shape of `.diffsense.json`. `defaults` apply to every format; `formats.<name>` overrides them for that
 * format only. Same file the VS Code extension reads.
 */
data class DiffSenseConfig(
    val defaults: CompareOptions = CompareOptions(),
    val formats: Map<Format, CompareOptions> = emptyMap(),
)

private val BOOLEANS = setOf(
    "ignoreWhitespace", "ignoreCase", "ignoreOrdering", "ignoreArrayOrder", "numericEquality",
    "ignoreXmlDeclaration", "ignoreNamespaces", "qaMode", "ignoreExtraFields",
)
private val LISTS = setOf("ignorePaths", "ignoreAttributes", "ignoreHeaders")

class Sanitized<T>(val value: T, val errors: List<String>)

/** Validates untrusted option input; returns cleaned options and problems. */
fun sanitizeOptions(raw: Any?, where: String = "options"): Sanitized<CompareOptions> {
    val errors = ArrayList<String>()
    if (raw == null) return Sanitized(CompareOptions(), errors)
    if (raw !is Map<*, *>) return Sanitized(CompareOptions(), listOf("$where: expected an object"))
    val b = HashMap<String, Any?>()
    for ((k, v) in raw) {
        val key = k as String
        when {
            key in BOOLEANS -> if (v is Boolean) b[key] = v else errors.add("$where.$key: expected boolean")
            key in LISTS -> if (v is List<*> && v.all { it is String }) b[key] = v.map { it as String }
            else errors.add("$where.$key: expected array of strings")
            key == "format" -> {
                val f = (v as? String)?.let { Format.byId(it) }
                if (f != null) b[key] = f else errors.add("$where.format: expected one of ${Format.entries.joinToString(", ") { it.id }}")
            }
            else -> errors.add("$where.$key: unknown option")
        }
    }
    @Suppress("UNCHECKED_CAST")
    val o = CompareOptions(
        format = b["format"] as Format?,
        ignoreWhitespace = b["ignoreWhitespace"] as Boolean?,
        ignoreCase = b["ignoreCase"] as Boolean?,
        ignoreOrdering = b["ignoreOrdering"] as Boolean?,
        ignoreArrayOrder = b["ignoreArrayOrder"] as Boolean?,
        ignorePaths = b["ignorePaths"] as List<String>?,
        numericEquality = b["numericEquality"] as Boolean?,
        ignoreXmlDeclaration = b["ignoreXmlDeclaration"] as Boolean?,
        ignoreAttributes = b["ignoreAttributes"] as List<String>?,
        ignoreNamespaces = b["ignoreNamespaces"] as Boolean?,
        ignoreExtraFields = b["ignoreExtraFields"] as Boolean?,
        ignoreHeaders = b["ignoreHeaders"] as List<String>?,
        qaMode = b["qaMode"] as Boolean?,
    )
    return Sanitized(o, errors)
}

/** Parses the text of a `.diffsense.json` file. Never throws; problems are returned. */
fun parseConfig(text: String): Sanitized<DiffSenseConfig> {
    val raw = try {
        JsonParser.parse(text.removePrefix("\uFEFF"))
    } catch (e: ParseError) {
        return Sanitized(DiffSenseConfig(), listOf("Invalid JSON: ${e.message}"))
    }
    if (raw !is Map<*, *>) return Sanitized(DiffSenseConfig(), listOf("Config must be a JSON object"))
    val errors = ArrayList<String>()
    for (k in raw.keys) if (k != "defaults" && k != "formats") errors.add("$k: unknown key")
    val d = sanitizeOptions(raw["defaults"], "defaults")
    errors.addAll(d.errors)
    val formats = LinkedHashMap<Format, CompareOptions>()
    val rf = raw["formats"]
    if (rf != null) {
        if (rf !is Map<*, *>) errors.add("formats: expected an object")
        else for ((name, v) in rf) {
            val f = Format.byId(name as String)
            if (f == null) { errors.add("formats.$name: unknown format"); continue }
            val s = sanitizeOptions(v, "formats.$name")
            errors.addAll(s.errors)
            formats[f] = s.value
        }
    }
    return Sanitized(DiffSenseConfig(d.value, formats), errors)
}

/** Effective options for a format: defaults, then per-format overrides, then explicit overrides. */
fun resolveOptions(config: DiffSenseConfig, format: Format, overrides: CompareOptions = CompareOptions()): CompareOptions =
    config.defaults.overlay(config.formats[format] ?: CompareOptions()).overlay(overrides)
