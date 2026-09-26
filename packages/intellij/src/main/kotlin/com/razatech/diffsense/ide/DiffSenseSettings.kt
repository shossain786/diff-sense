package com.razatech.diffsense.ide

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service
import com.razatech.diffsense.engine.CompareOptions

/** Application-wide ignore rules. A project's `.diffsense.json` overrides them. */
@Service(Service.Level.APP)
@State(name = "DiffSenseSettings", storages = [Storage("diffsense.xml")])
class DiffSenseSettings : PersistentStateComponent<DiffSenseSettings.State> {
    class State {
        var ignoreWhitespace: Boolean = false
        var ignoreCase: Boolean = false
        var ignoreArrayOrder: Boolean = false
        var numericEquality: Boolean = false
        var ignoreNamespaces: Boolean = false
        var ignoreXmlDeclaration: Boolean = false
        var ignoreExtraFields: Boolean = false
        /** One glob per line. */
        var ignorePaths: String = ""
        var ignoreAttributes: String = ""
        var ignoreHeaders: String = ""
        var maxFileSizeMb: Int = 10
    }

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    /** Only options that are switched on are set, so they never override a config file with `false`. */
    fun toOptions(): CompareOptions {
        val s = state
        fun lines(v: String) = v.lines().map { it.trim() }.filter { it.isNotEmpty() }.ifEmpty { null }
        return CompareOptions(
            ignoreWhitespace = s.ignoreWhitespace.takeIf { it },
            ignoreCase = s.ignoreCase.takeIf { it },
            ignoreArrayOrder = s.ignoreArrayOrder.takeIf { it },
            numericEquality = s.numericEquality.takeIf { it },
            ignoreNamespaces = s.ignoreNamespaces.takeIf { it },
            ignoreXmlDeclaration = s.ignoreXmlDeclaration.takeIf { it },
            ignoreExtraFields = s.ignoreExtraFields.takeIf { it },
            ignorePaths = lines(s.ignorePaths),
            ignoreAttributes = lines(s.ignoreAttributes),
            ignoreHeaders = lines(s.ignoreHeaders),
        )
    }

    companion object {
        fun getInstance(): DiffSenseSettings = service()
    }
}
