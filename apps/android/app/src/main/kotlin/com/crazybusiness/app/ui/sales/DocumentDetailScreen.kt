package com.crazybusiness.app.ui.sales

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.crazybusiness.app.ui.common.BackBar
import com.crazybusiness.app.ui.common.FormField
import com.crazybusiness.app.ui.common.LabelValue
import com.crazybusiness.app.ui.common.LoadView
import com.crazybusiness.app.ui.common.LocalContainer
import com.crazybusiness.app.ui.common.PAYMENT_METHODS
import com.crazybusiness.app.ui.common.PickerField
import com.crazybusiness.app.ui.common.SectionCard
import com.crazybusiness.app.ui.common.StatusChip
import com.crazybusiness.app.ui.common.dateIN
import com.crazybusiness.app.ui.common.docLabel
import com.crazybusiness.app.ui.common.inr
import com.crazybusiness.app.ui.common.rememberLoad
import com.crazybusiness.app.ui.common.userMessage
import com.crazybusiness.app.ui.theme.Danger
import com.crazybusiness.app.ui.theme.Muted
import com.crazybusiness.app.util.Share
import com.crazybusiness.core.api.Allocation
import com.crazybusiness.core.api.ApiClient
import com.crazybusiness.core.api.DocumentDetail
import com.crazybusiness.core.api.PaymentInput
import com.crazybusiness.core.india.India
import kotlinx.coroutines.launch
import java.math.BigDecimal

@Composable
fun DocumentDetailScreen(id: String, onBack: () -> Unit, openDocument: (String) -> Unit) {
    val c = LocalContainer.current
    val ctx by c.context.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val data = rememberLoad(id) { c.api.document(id) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var paying by remember { mutableStateOf(false) }

    fun act(block: suspend () -> Unit) {
        busy = true
        message = null
        scope.launch {
            try { block() } catch (e: Exception) { message = e.userMessage() } finally { busy = false }
        }
    }

    Column(Modifier.fillMaxSize()) {
        BackBar("Document", onBack)
        LoadView(data) { d ->
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionCard {
                    Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                        Text("${docLabel(d.docType)} ${d.number ?: "(draft)"}", fontWeight = FontWeight.SemiBold)
                        StatusChip(d.status, d.isOverdue)
                    }
                    Text(d.partyName, style = MaterialTheme.typography.titleMedium)
                    Text("Issued ${dateIN(d.issueDate)}" + (d.dueDate?.let { " · Due ${dateIN(it)}" } ?: ""), color = Muted)
                    Text("Place of supply: ${India.stateName(d.placeOfSupply)}", color = Muted)
                }
                SectionCard {
                    d.items.forEach { item ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(item.description)
                                Text("${item.quantity} ${item.unit} × ${inr(item.unitPrice)} · GST ${BigDecimal(item.taxRate).stripTrailingZeros().toPlainString()}%", style = MaterialTheme.typography.bodySmall, color = Muted)
                                if (item.serialNumbers.isNotEmpty()) Text("S/N: ${item.serialNumbers.joinToString()}", style = MaterialTheme.typography.bodySmall, color = Muted)
                            }
                            Text(inr(item.total))
                        }
                    }
                    HorizontalDivider(Modifier.padding(vertical = 6.dp))
                    Totals(d)
                }
                message?.let { Text(it, color = Danger) }
                Actions(
                    d = d,
                    busy = busy,
                    canPay = ctx?.can("payments.create") == true,
                    issue = { act { c.api.finalizeDocument(d.id); data.reload() } },
                    convert = { act { openDocument(c.api.convertDocument(d.id, "invoice").id) } },
                    whatsapp = {
                        act {
                            val s = c.api.shareDocument(d.id)
                            Share.openUrl(context, s.whatsappUrl)
                            runCatching { c.api.markShared(d.id) }
                        }
                    },
                    pdf = {
                        act {
                            val bytes = c.api.documentPdf(d.id)
                            Share.sharePdf(context, bytes, "${d.number ?: "draft"}.pdf")
                        }
                    },
                    pay = { paying = true },
                )
            }
            if (paying) PaymentDialog(d, onDismiss = { paying = false }, onDone = { paying = false; data.reload() })
        }
    }
}

@Composable
private fun Totals(d: DocumentDetail) {
    LabelValue("Taxable value", inr(d.taxableTotal))
    if (d.isInterState) LabelValue("IGST", inr(d.igstTotal)) else {
        LabelValue("CGST", inr(d.cgstTotal))
        LabelValue("SGST", inr(d.sgstTotal))
    }
    if (BigDecimal(d.roundOff).signum() != 0) LabelValue("Round off", inr(d.roundOff))
    LabelValue("Total", inr(d.grandTotal), bold = true)
    if (d.docType == "invoice" && d.status != "draft") {
        LabelValue("Received", inr(d.amountSettled))
        LabelValue("Balance due", inr(d.balanceDue), bold = true)
    }
}

@Composable
private fun Actions(d: DocumentDetail, busy: Boolean, canPay: Boolean, issue: () -> Unit, convert: () -> Unit, whatsapp: () -> Unit, pdf: () -> Unit, pay: () -> Unit) {
    val draft = d.status == "draft"
    val cancelled = d.status == "cancelled"
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (draft) Button(onClick = issue, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (d.docType == "invoice") "Issue invoice" else "Finalize") }
        if (d.docType == "invoice" && !draft && !cancelled && BigDecimal(d.balanceDue).signum() > 0 && canPay) {
            Button(onClick = pay, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Record payment") }
        }
        if (d.docType == "quotation" && !draft && d.status !in listOf("converted", "cancelled", "rejected")) {
            OutlinedButton(onClick = convert, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Convert to invoice") }
        }
        if (!draft && !cancelled) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = whatsapp, enabled = !busy, modifier = Modifier.weight(1f)) { Text("WhatsApp") }
                OutlinedButton(onClick = pdf, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Share PDF") }
            }
        }
    }
}

@Composable
private fun PaymentDialog(d: DocumentDetail, onDismiss: () -> Unit, onDone: () -> Unit) {
    val c = LocalContainer.current
    val ctx by c.context.collectAsState()
    val scope = rememberCoroutineScope()
    val key = remember { ApiClient.newIdempotencyKey() }
    var amount by remember { mutableStateOf(d.balanceDue) }
    var method by remember { mutableStateOf("cash") }
    var reference by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val value = amount.toBigDecimalOrNull()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Record payment") },
        text = {
            Column {
                Text("Balance due ${inr(d.balanceDue)}", color = Muted)
                FormField(amount, { amount = it.filter { ch -> ch.isDigit() || ch == '.' } }, "Amount received ₹", keyboard = KeyboardType.Decimal)
                PickerField("Method", PAYMENT_METHODS, method, { method = it })
                if (method != "cash") FormField(reference, { reference = it }, "Reference / UTR (optional)")
                if (value != null && value > BigDecimal(d.balanceDue)) Text("Extra ${inr(value - BigDecimal(d.balanceDue))} will be kept as advance for this customer.", color = Muted)
                error?.let { Text(it, color = Danger) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && value != null && value.signum() > 0, onClick = {
                busy = true
                scope.launch {
                    try {
                        val alloc = value!!.min(BigDecimal(d.balanceDue))
                        c.api.recordPayment(
                            PaymentInput(
                                direction = "in",
                                partyId = d.partyId,
                                amount = value.toPlainString(),
                                method = method,
                                paidOn = ctx?.today ?: India.today().toString(),
                                reference = reference.ifBlank { null },
                                allocations = if (alloc.signum() > 0) listOf(Allocation(d.id, alloc.toPlainString())) else emptyList(),
                            ),
                            key,
                        )
                        onDone()
                    } catch (e: Exception) {
                        error = e.userMessage()
                    } finally {
                        busy = false
                    }
                }
            }) { Text(if (busy) "Saving…" else "Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
