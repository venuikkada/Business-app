package com.crazybusiness.app.ui.sales

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.crazybusiness.app.sync.SyncWorker
import com.crazybusiness.app.ui.common.BackBar
import com.crazybusiness.app.ui.common.FormField
import com.crazybusiness.app.ui.common.LabelValue
import com.crazybusiness.app.ui.common.Load
import com.crazybusiness.app.ui.common.LocalContainer
import com.crazybusiness.app.ui.common.PickerField
import com.crazybusiness.app.ui.common.SectionCard
import com.crazybusiness.app.ui.common.docLabel
import com.crazybusiness.app.ui.common.inr
import com.crazybusiness.app.ui.common.rememberLoad
import com.crazybusiness.app.ui.common.userMessage
import com.crazybusiness.app.ui.theme.Danger
import com.crazybusiness.app.ui.theme.Muted
import com.crazybusiness.core.api.ApiClient
import com.crazybusiness.core.api.ApiException
import com.crazybusiness.core.api.DocumentInput
import com.crazybusiness.core.api.DocumentItemInput
import com.crazybusiness.core.api.PartyDetail
import com.crazybusiness.core.api.ProductRow
import com.crazybusiness.core.drafts.OfflineDraft
import com.crazybusiness.core.gst.GstCalculator
import com.crazybusiness.core.india.India
import kotlinx.coroutines.launch
import java.io.IOException
import java.math.BigDecimal

/** One editable line. Strings hold what the user typed; parsing happens in totals(). */
private data class Line(
    val productId: String?,
    val description: String,
    val hsn: String?,
    val unit: String,
    val qty: String,
    val price: String,
    val rate: BigDecimal,
    val trackSerials: Boolean,
    val serials: String = "",
)

private fun ProductRow.toLine() = Line(id, name, hsnCode, unit, "1", sellingPrice, BigDecimal(taxRate).stripTrailingZeros(), trackSerials)

@Composable
fun DocumentEditorScreen(type: String, initialPartyId: String?, onBack: () -> Unit, onSaved: (String) -> Unit, onSavedOffline: () -> Unit) {
    val c = LocalContainer.current
    val ctx by c.context.collectAsState()
    val scope = rememberCoroutineScope()
    val androidContext = LocalContext.current
    // One key per editor session: retries never create a second document.
    val idempotencyKey = rememberSaveable { ApiClient.newIdempotencyKey() }
    var party by remember { mutableStateOf<PartyDetail?>(null) }
    val lines = remember { mutableStateListOf<Line>() }
    var pickParty by remember { mutableStateOf(false) }
    var pickProduct by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var stockWarning by remember { mutableStateOf<Pair<String, String>?>(null) } // documentId to message

    LaunchedEffect(initialPartyId) {
        if (initialPartyId != null && party == null) party = runCatching { c.api.party(initialPartyId) }.getOrNull()
    }

    val settings = ctx?.settings
    val noTax = settings?.gstScheme != null && settings.gstScheme != "regular"
    val businessState = ctx?.business?.stateCode
    val inter = party?.supplyState?.let { it != businessState } ?: false
    val totals = remember(lines.toList(), inter, settings) {
        runCatching {
            GstCalculator.calculate(
                GstCalculator.Input(
                    lines = lines.map { GstCalculator.Line(BigDecimal(it.qty), BigDecimal(it.price), if (noTax) BigDecimal.ZERO else it.rate) },
                    pricesIncludeTax = settings?.pricesIncludeTax ?: false,
                    isInterState = inter,
                    roundOff = settings?.roundOffTotals ?: true,
                ),
            )
        }
    }

    fun buildInput() = DocumentInput(
        docType = type,
        partyId = party!!.id,
        issueDate = ctx?.today ?: India.today().toString(),
        items = lines.map {
            DocumentItemInput(
                productId = it.productId,
                description = it.description,
                hsnCode = it.hsn,
                quantity = it.qty,
                unit = it.unit,
                unitPrice = it.price,
                taxRate = it.rate.toDouble(),
                serialNumbers = it.serials.split(',', '\n').map(String::trim).filter(String::isNotEmpty),
            )
        },
        pricesIncludeTax = settings?.pricesIncludeTax ?: false,
        roundOff = settings?.roundOffTotals ?: true,
    )

    fun save(issue: Boolean) {
        val input = buildInput()
        busy = true
        error = null
        scope.launch {
            try {
                val created = c.api.createDocument(input, idempotencyKey)
                if (issue && created.status == "draft") {
                    try {
                        c.api.finalizeDocument(created.id)
                    } catch (e: ApiException) {
                        when (e.code) {
                            "NEGATIVE_STOCK" -> { stockWarning = created.id to e.message; return@launch }
                            "APPROVAL_REQUIRED" -> error = e.message
                            else -> error = "Saved as draft. Not issued: ${e.message}"
                        }
                    }
                }
                onSaved(created.id)
            } catch (e: IOException) {
                // Network dropped: keep the draft on the phone and sync it automatically later.
                val businessId = c.session.businessId ?: return@launch
                c.drafts.saveNew(
                    OfflineDraft(idempotencyKey, businessId, System.currentTimeMillis(), input, issueOnSync = issue),
                    partyName = party!!.name,
                    estimatedTotal = totals.getOrNull()?.grandTotal?.toPlainString() ?: "0",
                )
                SyncWorker.enqueue(androidContext)
                onSavedOffline()
            } catch (e: Exception) {
                error = e.userMessage()
            } finally {
                busy = false
            }
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        BackBar("New ${docLabel(type).lowercase()}", onBack)
        LazyColumn(Modifier.weight(1f), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                SectionCard(Modifier.clickable { pickParty = true }) {
                    Text("Customer", color = Muted)
                    Text(party?.name ?: "Tap to choose customer", fontWeight = FontWeight.SemiBold)
                    party?.let {
                        Text(listOfNotNull(it.gstin, India.stateName(it.supplyState).ifBlank { null }).joinToString(" · "), color = Muted)
                        Text(if (inter) "Inter-state supply: IGST" else "Intra-state supply: CGST + SGST", style = MaterialTheme.typography.bodySmall, color = Muted)
                    }
                }
            }
            itemsIndexed(lines) { i, line -> LineEditor(line, noTax, onChange = { lines[i] = it }, onRemove = { lines.removeAt(i) }) }
            item {
                OutlinedButton(onClick = { pickProduct = true }, modifier = Modifier.fillMaxWidth()) { Text("+ Add item") }
            }
            item {
                SectionCard {
                    totals.fold(
                        onSuccess = { t ->
                            LabelValue("Taxable value", inr(t.taxableTotal))
                            if (!noTax) {
                                if (inter) LabelValue("IGST", inr(t.igstTotal)) else {
                                    LabelValue("CGST", inr(t.cgstTotal))
                                    LabelValue("SGST", inr(t.sgstTotal))
                                }
                            }
                            if (t.roundOff.signum() != 0) LabelValue("Round off", inr(t.roundOff))
                            HorizontalDivider(Modifier.padding(vertical = 6.dp))
                            LabelValue("Total", inr(t.grandTotal), bold = true)
                            if (noTax) Text("Bill of supply — no GST charged (${settings?.gstScheme} scheme).", style = MaterialTheme.typography.bodySmall, color = Muted)
                        },
                        onFailure = { Text("Check quantities and prices — ${it.message ?: "invalid number"}", color = Danger) },
                    )
                }
            }
            error?.let { item { Text(it, color = Danger) } }
        }
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val ok = !busy && party != null && lines.isNotEmpty() && totals.isSuccess
            OutlinedButton(onClick = { save(issue = false) }, enabled = ok, modifier = Modifier.weight(1f)) { Text("Save draft") }
            Button(onClick = { save(issue = true) }, enabled = ok, modifier = Modifier.weight(1f)) {
                if (busy) CircularProgressIndicator(Modifier.width(18.dp)) else Text(if (type == "invoice") "Save & issue" else "Save & send")
            }
        }
    }

    if (pickParty) PartySearchDialog(onDismiss = { pickParty = false }) { id ->
        pickParty = false
        scope.launch { runCatching { party = c.api.party(id) }.onFailure { error = it.userMessage() } }
    }
    if (pickProduct) ProductSearchDialog(onDismiss = { pickProduct = false }) { p ->
        pickProduct = false
        lines.add(p.toLine())
    }
    stockWarning?.let { (docId, msg) ->
        AlertDialog(
            onDismissRequest = { stockWarning = null; onSaved(docId) },
            title = { Text("Not enough stock") },
            text = { Text("$msg\n\nThe invoice is saved as a draft. Owners/managers can issue it anyway; the override is recorded in the audit log.") },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        runCatching { c.api.finalizeDocument(docId, allowNegativeStock = true) }.onFailure { error = it.userMessage() }
                        stockWarning = null
                        onSaved(docId)
                    }
                }) { Text("Issue anyway") }
            },
            dismissButton = { TextButton(onClick = { stockWarning = null; onSaved(docId) }) { Text("Keep as draft") } },
        )
    }
}

private val RATE_OPTIONS = GstCalculator.SUPPORTED_RATES.map { it to "${it.stripTrailingZeros().toPlainString()}%" }

@Composable
private fun LineEditor(line: Line, noTax: Boolean, onChange: (Line) -> Unit, onRemove: () -> Unit) {
    SectionCard {
        Row {
            Column(Modifier.weight(1f)) {
                Text(line.description, fontWeight = FontWeight.SemiBold)
                line.hsn?.let { Text("HSN/SAC $it", style = MaterialTheme.typography.bodySmall, color = Muted) }
            }
            IconButton(onClick = onRemove) { Icon(Icons.Default.Delete, "Remove") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FormField(line.qty, { onChange(line.copy(qty = it.filter { ch -> ch.isDigit() || ch == '.' })) }, "Qty (${line.unit})", Modifier.weight(1f), keyboard = KeyboardType.Decimal)
            FormField(line.price, { onChange(line.copy(price = it.filter { ch -> ch.isDigit() || ch == '.' })) }, "Rate ₹", Modifier.weight(1.4f), keyboard = KeyboardType.Decimal)
        }
        if (!noTax) PickerField("GST rate", RATE_OPTIONS, line.rate.stripTrailingZeros().let { r -> RATE_OPTIONS.firstOrNull { it.first.compareTo(r) == 0 }?.first }, { onChange(line.copy(rate = it)) })
        if (line.trackSerials) {
            FormField(line.serials, { onChange(line.copy(serials = it)) }, "Serial numbers (comma separated)", singleLine = false)
        }
    }
}

@Composable
fun PartySearchDialog(onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val c = LocalContainer.current
    var q by remember { mutableStateOf("") }
    val data = rememberLoad(q) { c.api.parties(q.ifBlank { null }, type = "customer") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Choose customer") },
        text = {
            Column {
                FormField(q, { q = it }, "Search name, phone or GSTIN")
                SearchResults(data.state, { it.items }) { p ->
                    Column(Modifier.fillMaxWidth().clickable { onPick(p.id) }.padding(vertical = 10.dp)) {
                        Text(p.name)
                        Text(listOfNotNull(p.phone?.let(India::formatPhone), p.billingCity).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Muted)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
fun ProductSearchDialog(onDismiss: () -> Unit, onPick: (ProductRow) -> Unit) {
    val c = LocalContainer.current
    var q by remember { mutableStateOf("") }
    val data = rememberLoad(q) { c.api.products(q.ifBlank { null }) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add item") },
        text = {
            Column {
                FormField(q, { q = it }, "Search name, SKU or barcode")
                SearchResults(data.state, { it.items }) { p ->
                    Row(Modifier.fillMaxWidth().clickable { onPick(p) }.padding(vertical = 10.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(p.name)
                            Text(listOfNotNull(p.sku, p.stock?.let { "Stock $it ${p.unit}" }).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Muted)
                        }
                        Text(inr(p.sellingPrice))
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}

@Composable
private fun <R, T> SearchResults(state: Load<R>, extract: (R) -> List<T>, row: @Composable (T) -> Unit) {
    when (state) {
        Load.Loading -> CircularProgressIndicator(Modifier.padding(16.dp))
        is Load.Failed -> Text(state.message, color = Danger, modifier = Modifier.padding(vertical = 8.dp))
        is Load.Ok -> {
            val list = extract(state.value)
            if (list.isEmpty()) Text("No matches", color = Muted, modifier = Modifier.padding(vertical = 8.dp))
            LazyColumn(Modifier.heightIn(max = 320.dp)) { items(list) { row(it) } }
        }
    }
    Spacer(Modifier.padding(2.dp))
}
