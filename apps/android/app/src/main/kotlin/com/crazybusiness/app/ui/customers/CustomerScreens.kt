package com.crazybusiness.app.ui.customers

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.crazybusiness.app.ui.common.BackBar
import com.crazybusiness.app.ui.common.EmptyState
import com.crazybusiness.app.ui.common.FormField
import com.crazybusiness.app.ui.common.LabelValue
import com.crazybusiness.app.ui.common.LoadView
import com.crazybusiness.app.ui.common.LocalContainer
import com.crazybusiness.app.ui.common.PickerField
import com.crazybusiness.app.ui.common.SectionCard
import com.crazybusiness.app.ui.common.inr
import com.crazybusiness.app.ui.common.rememberLoad
import com.crazybusiness.app.ui.common.userMessage
import com.crazybusiness.app.ui.theme.Danger
import com.crazybusiness.app.ui.theme.Muted
import com.crazybusiness.app.util.Share
import com.crazybusiness.core.api.Address
import com.crazybusiness.core.api.ApiClient
import com.crazybusiness.core.api.ApiException
import com.crazybusiness.core.api.CreatePartyRequest
import com.crazybusiness.core.india.India
import kotlinx.coroutines.launch
import java.math.BigDecimal

private val TABS = listOf("customer" to "Customers", "supplier" to "Suppliers")

@Composable
fun CustomersScreen(openParty: (String) -> Unit, addParty: () -> Unit) {
    val c = LocalContainer.current
    var tab by rememberSaveable { mutableStateOf(0) }
    var q by rememberSaveable { mutableStateOf("") }
    val data = rememberLoad(tab, q) { c.api.parties(q.ifBlank { null }, type = TABS[tab].first) }
    Scaffold(floatingActionButton = { FloatingActionButton(onClick = addParty) { Icon(Icons.Default.PersonAdd, "Add customer") } }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            TabRow(selectedTabIndex = tab) { TABS.forEachIndexed { i, (_, l) -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(l) }) } }
            FormField(q, { q = it }, "Search name, phone, GSTIN", Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            LoadView(data) { page ->
                if (page.items.isEmpty()) EmptyState("No ${TABS[tab].second.lowercase()} yet", "Tap + to add one.")
                else LazyColumn(Modifier.fillMaxSize()) {
                    items(page.items, key = { it.id }) { p ->
                        Row(Modifier.fillMaxWidth().clickable { openParty(p.id) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(p.name, maxLines = 1)
                                Text(listOfNotNull(p.phone?.let(India::formatPhone), p.billingCity).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Muted)
                            }
                            p.balance?.toBigDecimalOrNull()?.takeIf { it.signum() != 0 }?.let { b ->
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(inr(b.abs()), color = if (b.signum() > 0) Danger else Muted)
                                    Text(if (b.signum() > 0) "to collect" else "advance / to pay", style = MaterialTheme.typography.bodySmall, color = Muted)
                                }
                            }
                        }
                        HorizontalDivider()
                    }
                }
            }
        }
    }
}

@Composable
fun CustomerDetailScreen(id: String, onBack: () -> Unit, newInvoice: () -> Unit) {
    val c = LocalContainer.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val data = rememberLoad(id) { c.api.party(id) }
    var message by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize()) {
        BackBar("Party", onBack)
        LoadView(data) { p ->
            Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionCard {
                    Text(p.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    p.phone?.let { LabelValue("Phone", India.formatPhone(it)) }
                    p.email?.let { LabelValue("Email", it) }
                    p.gstin?.let { LabelValue("GSTIN", it) }
                    val addr = p.billingAddress
                    listOfNotNull(addr.line1, addr.city, India.stateName(addr.stateCode).ifBlank { null }, addr.pincode).joinToString(", ").takeIf { it.isNotBlank() }?.let { LabelValue("Address", it) }
                }
                val bal = BigDecimal(p.balance)
                SectionCard {
                    Text(if (bal.signum() >= 0) "Balance to collect" else "Advance / payable", color = Muted)
                    Text(inr(bal.abs()), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, color = if (bal.signum() > 0) Danger else MaterialTheme.colorScheme.onSurface)
                }
                message?.let { Text(it, color = Danger) }
                if (p.isCustomer) Button(onClick = newInvoice, modifier = Modifier.fillMaxWidth()) { Text("New invoice") }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    p.phone?.let { phone ->
                        OutlinedButton(onClick = { Share.openUrl(context, "tel:$phone") }, modifier = Modifier.weight(1f)) { Text("Call") }
                    }
                    if (bal.signum() > 0 && p.phone != null) {
                        OutlinedButton(onClick = {
                            scope.launch {
                                try {
                                    val r = c.api.paymentReminder(p.id)
                                    Share.openUrl(context, r.url)
                                } catch (e: Exception) {
                                    message = e.userMessage()
                                }
                            }
                        }, modifier = Modifier.weight(1f)) { Text("WhatsApp reminder") }
                    }
                }
                Text("Reminders open WhatsApp with a ready message; you press send. Nothing is sent automatically.", style = MaterialTheme.typography.bodySmall, color = Muted)
            }
        }
    }
}

@Composable
fun AddCustomerScreen(onBack: () -> Unit, onCreated: (String) -> Unit) {
    val c = LocalContainer.current
    val scope = rememberCoroutineScope()
    val key = rememberSaveable { ApiClient.newIdempotencyKey() }
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var gstin by rememberSaveable { mutableStateOf("") }
    var state by rememberSaveable { mutableStateOf<String?>(null) }
    var city by rememberSaveable { mutableStateOf("") }
    var supplier by rememberSaveable { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var duplicate by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val phoneError = if (phone.isNotBlank() && India.normalizePhone(phone) == null) "Enter a valid 10-digit Indian mobile number" else null
    val gstinError = gstin.takeIf { it.isNotBlank() }?.let(India::validateGstin)
    val effectiveState = state ?: gstin.takeIf { gstinError == null && it.length == 15 }?.take(2)

    fun submit(confirmDuplicate: Boolean) {
        busy = true
        error = null
        scope.launch {
            try {
                val p = c.api.createParty(
                    CreatePartyRequest(
                        name = name.trim(),
                        phone = India.normalizePhone(phone),
                        gstin = gstin.ifBlank { null },
                        isCustomer = !supplier,
                        isSupplier = supplier,
                        billingAddress = Address(city = city.ifBlank { null }, stateCode = effectiveState),
                        confirmDuplicate = confirmDuplicate,
                    ),
                    // A confirmed retry is a different request, so it needs its own key.
                    if (confirmDuplicate) ApiClient.newIdempotencyKey() else key,
                )
                onCreated(p.id)
            } catch (e: ApiException) {
                if (e.code == "POSSIBLE_DUPLICATE") duplicate = e.message else error = e.message
            } catch (e: Exception) {
                error = e.userMessage()
            } finally {
                busy = false
            }
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        BackBar("Add party", onBack)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
            TabRow(selectedTabIndex = if (supplier) 1 else 0) {
                Tab(selected = !supplier, onClick = { supplier = false }, text = { Text("Customer") })
                Tab(selected = supplier, onClick = { supplier = true }, text = { Text("Supplier") })
            }
            FormField(name, { name = it }, "Name")
            FormField(phone, { phone = it }, "Mobile", keyboard = KeyboardType.Phone, error = phoneError)
            FormField(gstin, { gstin = it.uppercase().take(15) }, "GSTIN (optional)", error = gstinError)
            PickerField("State (for place of supply)", India.STATES, effectiveState, { state = it }, searchable = true)
            FormField(city, { city = it }, "City")
            error?.let { Text(it, color = Danger) }
            Button(onClick = { submit(false) }, enabled = !busy && name.isNotBlank() && phoneError == null && gstinError == null, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
                Text(if (busy) "Saving…" else "Save")
            }
        }
    }
    duplicate?.let { msg ->
        AlertDialog(
            onDismissRequest = { duplicate = null },
            title = { Text("Possible duplicate") },
            text = { Text(msg) },
            confirmButton = { TextButton(onClick = { duplicate = null; submit(true) }) { Text("Create anyway") } },
            dismissButton = { TextButton(onClick = { duplicate = null }) { Text("Cancel") } },
        )
    }
}
