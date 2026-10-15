package com.crazybusiness.app.ui.business

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.crazybusiness.app.ui.common.EmptyState
import com.crazybusiness.app.ui.common.FormField
import com.crazybusiness.app.ui.common.LoadView
import com.crazybusiness.app.ui.common.LocalContainer
import com.crazybusiness.app.ui.common.PickerField
import com.crazybusiness.app.ui.common.rememberLoad
import com.crazybusiness.app.ui.common.userMessage
import com.crazybusiness.app.ui.theme.Danger
import com.crazybusiness.app.ui.theme.Muted
import com.crazybusiness.core.api.Address
import com.crazybusiness.core.api.CreateBusinessRequest
import com.crazybusiness.core.india.India
import kotlinx.coroutines.launch

@Composable
fun BusinessPickerScreen(onSelected: () -> Unit, onCreate: () -> Unit, onLoggedOut: () -> Unit) {
    val c = LocalContainer.current
    val scope = rememberCoroutineScope()
    val me = rememberLoad { c.api.me() }
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        Text("Choose a business", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(20.dp))
        LoadView(me) { data ->
            val active = data.businesses.filter { it.status != "deleted" }
            if (active.isEmpty()) {
                EmptyState("No business yet", "Set up your shop or company in under a minute.") { Button(onClick = onCreate) { Text("Set up business") } }
            } else {
                LazyColumn(Modifier.weight(1f)) {
                    items(active, key = { it.id }) { b ->
                        ListItem(
                            headlineContent = { Text(b.name) },
                            supportingContent = { Text(listOfNotNull(b.roleName, b.planName, b.city).joinToString(" · "), color = Muted) },
                            trailingContent = { if (b.status == "suspended") Text("Suspended", color = Danger) },
                            modifier = Modifier.clickable {
                                scope.launch { c.session.selectBusiness(b.id); onSelected() }
                            },
                        )
                        HorizontalDivider()
                    }
                    item {
                        OutlinedButton(onClick = onCreate, modifier = Modifier.fillMaxWidth().padding(20.dp)) { Text("Add another business") }
                    }
                }
            }
        }
        TextButton(onClick = {
            scope.launch {
                runCatching { c.api.logout() }
                c.session.clear()
                onLoggedOut()
            }
        }, modifier = Modifier.padding(12.dp)) { Text("Sign out") }
    }
}

private val BUSINESS_TYPES = listOf(
    "retail" to "Retail shop", "wholesale" to "Wholesale", "distributor" to "Distributor", "it_dealer" to "IT dealer",
    "cctv" to "CCTV / security", "computer_shop" to "Computer shop", "electronics" to "Electronics", "services" to "Service company",
    "freelancer" to "Freelancer", "other" to "Other",
)

@Composable
fun CreateBusinessScreen(onCreated: () -> Unit) {
    val c = LocalContainer.current
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf("") }
    var type by rememberSaveable { mutableStateOf("retail") }
    var state by rememberSaveable { mutableStateOf<String?>(null) }
    var gstin by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var city by rememberSaveable { mutableStateOf("") }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val gstinError = gstin.takeIf { it.isNotBlank() }?.let(India::validateGstin)
    val effectiveState = state ?: gstin.takeIf { it.length >= 2 && gstinError == null }?.take(2)

    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Set up your business", style = MaterialTheme.typography.headlineSmall)
        Text("You can change all of this later in Settings.", color = Muted)
        Spacer(Modifier.height(16.dp))
        FormField(name, { name = it }, "Business name")
        PickerField("Business type", BUSINESS_TYPES, type, { type = it })
        FormField(gstin, { gstin = it.uppercase().take(15) }, "GSTIN (optional)", error = gstinError)
        PickerField("State", India.STATES.map { it.first to it.second }, effectiveState, { state = it }, searchable = true)
        if (gstin.length >= 2 && effectiveState != null && gstinError == null && gstin.take(2) != effectiveState) {
            Text("State doesn't match the GSTIN's state code (${gstin.take(2)}).", color = Danger)
        }
        FormField(city, { city = it }, "City")
        FormField(phone, { phone = it }, "Business phone (optional)", keyboard = KeyboardType.Phone)
        error?.let { Text(it, color = Danger, modifier = Modifier.padding(vertical = 8.dp)) }
        Button(
            onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        val res = c.api.createBusiness(
                            CreateBusinessRequest(
                                name = name.trim(),
                                stateCode = effectiveState!!,
                                businessType = type,
                                gstin = gstin.ifBlank { null },
                                phone = India.normalizePhone(phone),
                                address = Address(city = city.ifBlank { null }, stateCode = effectiveState),
                            ),
                        )
                        c.session.selectBusiness(res.id)
                        onCreated()
                    } catch (e: Exception) {
                        error = e.userMessage()
                    } finally {
                        busy = false
                    }
                }
            },
            enabled = !busy && name.length >= 2 && effectiveState != null && gstinError == null,
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(52.dp),
        ) { Text(if (busy) "Creating…" else "Create business") }
    }
}
