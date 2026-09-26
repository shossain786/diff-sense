package com.razatech.diffsense.ide

import com.intellij.openapi.options.BoundSearchableConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.bindIntText
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.panel
import com.intellij.ui.dsl.builder.rows

/** Settings | Tools | DiffSense */
class DiffSenseConfigurable : BoundSearchableConfigurable("DiffSense", "com.razatech.diffsense.settings") {
    override fun createPanel(): DialogPanel {
        val s = DiffSenseSettings.getInstance().state
        return panel {
            group("Comparison") {
                row { checkBox("Ignore whitespace differences").bindSelected(s::ignoreWhitespace) }
                row { checkBox("Ignore letter case in values").bindSelected(s::ignoreCase) }
                row { checkBox("Treat arrays (and repeated XML elements) as unordered").bindSelected(s::ignoreArrayOrder) }
                row { checkBox("Treat numerically equal values as equal (\"30\" = 30)").bindSelected(s::numericEquality) }
            }
            group("XML") {
                row { checkBox("Ignore namespace prefixes").bindSelected(s::ignoreNamespaces) }
                row { checkBox("Ignore the <?xml ...?> declaration").bindSelected(s::ignoreXmlDeclaration) }
                row("Ignored attributes:") {
                    textArea().rows(3).bindText(s::ignoreAttributes).comment("One attribute name per line.")
                }
            }
            group("API responses") {
                row { checkBox("Ignore fields that are only in the actual response").bindSelected(s::ignoreExtraFields) }
                row("Ignored headers:") {
                    textArea().rows(3).bindText(s::ignoreHeaders).comment("One header name per line. Date, Server and request IDs are always ignored.")
                }
            }
            group("Ignored paths") {
                row {
                    textArea().rows(4).bindText(s::ignorePaths)
                        .comment("One glob per line, e.g. <code>metadata.*</code>, <code>**.timestamp</code>, <code>items[*].id</code>. A <code>.diffsense.json</code> in the project root overrides these settings.")
                }
            }
            group("Limits") {
                row("Maximum file size (MB):") { intTextField(1..1024).bindIntText(s::maxFileSizeMb) }
            }
        }
    }
}
