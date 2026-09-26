package com.razatech.diffsense.engine

/** Detect the format from the file name; falls back to plain text. */
fun detectFormat(name: String): Format = when (name.substringAfterLast('.').lowercase()) {
    "json" -> Format.JSON
    "xml" -> Format.XML
    "yaml", "yml" -> Format.YAML
    "java" -> Format.JAVA
    else -> Format.TEXT
}

private fun compareRaw(left: FileInput, right: FileInput, options: CompareOptions): ComparisonResult {
    val format = options.format ?: detectFormat(left.name)
    try {
        when (format) {
            Format.JSON -> {
                val changes = diffValues(parseJson(left), parseJson(right), options)
                return ComparisonResult(Format.JSON, left.name, right.name, changes, computeStats(changes), null, emptyList())
            }
            Format.YAML -> return compareYaml(left, right, options)
            Format.XML -> return compareXml(left, right, options)
            Format.API -> return compareApi(left, right, options)
            else -> {}
        }
    } catch (e: ParseError) {
        return compareText(left, right, options, Format.TEXT, listOf("Invalid ${format.id.uppercase()}, fell back to text comparison (${e.message})"))
    }
    val warnings = when (format) {
        Format.TEXT -> emptyList()
        Format.JAVA -> listOf("Java semantic analysis is not available in the IntelliJ plugin yet; used text comparison")
        else -> listOf("No structural comparator for ${format.id} yet; used text comparison")
    }
    return compareText(left, right, options, Format.TEXT, warnings)
}

private fun parseJson(input: FileInput): Any? =
    try {
        JsonParser.parse(input.content.removePrefix("\uFEFF")) // editors on Windows often save a BOM
    } catch (e: ParseError) {
        throw ParseError("${input.name}: ${e.message}")
    }

/** Compares [left] with [right] (for `Format.API`: expected vs actual) and adds impact estimates. */
fun compare(left: FileInput, right: FileInput, options: CompareOptions = CompareOptions()): ComparisonResult =
    applyImpact(compareRaw(left, right, options))
