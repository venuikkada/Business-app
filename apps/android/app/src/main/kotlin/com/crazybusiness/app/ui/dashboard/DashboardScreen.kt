package com.crazybusiness.app.ui.dashboard

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.crazybusiness.app.ui.common.LabelValue
import com.crazybusiness.app.ui.common.LoadView
import com.crazybusiness.app.ui.common.LocalContainer
import com.crazybusiness.app.ui.common.SectionCard
import com.crazybusiness.app.ui.common.StatusChip
import com.crazybusiness.app.ui.common.dateIN
import com.crazybusiness.app.ui.common.docLabel
import com.crazybusiness.app.ui.common.inr
import com.crazybusiness.app.ui.common.rememberLoad
import com.crazybusiness.app.ui.theme.Danger
import com.crazybusiness.app.ui.theme.Muted

private val PRESETS = listOf("today" to "Today", "week" to "This week", "month" to "This month", "fy" to "This FY")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    openDocument: (String) -> Unit,
    newInvoice: () -> Unit,
    newQuotation: () -> Unit,
    openOutstanding: () -> Unit,
    openNotifications: () -> Unit,
    openScanner: () -> Unit,
) {
    val c = LocalContainer.current
    val ctx by c.context.collectAsState()
    var preset by rememberSaveable { mutableStateOf("month") }
    val data = rememberLoad(preset, ctx?.business?.id) { c.api.dashboard(preset) }
    val fin = ctx?.can("financials.view") == true

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Column { Text(ctx?.business?.name ?: "Dashboard", maxLines = 1); ctx?.plan?.let { Text(it.name, style = MaterialTheme.typography.labelSmall, color = Muted) } } },
            actions = {
                IconButton(onClick = openScanner) { Icon(Icons.Default.QrCodeScanner, "Scan barcode") }
                IconButton(onClick = openNotifications) { Icon(Icons.Default.Notifications, "Notifications") }
            },
        )
        LoadView(data) { d ->
            LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = newInvoice, modifier = Modifier.weight(1f)) { Text("+ Invoice") }
                        OutlinedButton(onClick = newQuotation, modifier = Modifier.weight(1f)) { Text("+ Quotation") }
                    }
                }
                item {
                    SectionCard {
                        Text("Today", color = Muted)
                        Text(inr(d.today.sales), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
                        Text("${d.today.invoices} invoice(s) today", color = Muted)
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                        PRESETS.forEach { (k, label) -> FilterChip(selected = preset == k, onClick = { preset = k }, label = { Text(label) }) }
                    }
                }
                item {
                    SectionCard {
                        Text("${dateIN(d.range.from)} – ${dateIN(d.range.to)}", color = Muted)
                        d.period.sales?.let { LabelValue("Sales (invoiced, incl. GST)", inr(it), bold = true) }
                        d.period.cashCollected?.let { LabelValue("Cash collected", inr(it)) }
                        d.period.purchases?.let { LabelValue("Purchases", inr(it)) }
                        d.period.expenses?.let { LabelValue("Expenses", inr(it)) }
                        if (fin) {
                            d.period.grossProfitEstimate?.let { LabelValue("Gross profit (estimate)", inr(it)) }
                            d.period.netProfitEstimate?.let { LabelValue("Net profit (estimate)", inr(it), bold = true) }
                        }
                        Text("Sales = invoice value. Cash = money actually received. Profit figures are estimates based on recorded costs.", style = MaterialTheme.typography.bodySmall, color = Muted, modifier = Modifier.padding(top = 6.dp))
                    }
                }
                d.dues?.let { dues ->
                    item {
                        SectionCard(Modifier.clickable(onClick = openOutstanding)) {
                            Text("Money to collect", color = Muted)
                            Text(inr(dues.receivable), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                            if (dues.overdueCount > 0) Text("${inr(dues.overdue)} overdue across ${dues.overdueCount} invoice(s) →", color = Danger)
                            dues.payable?.let { LabelValue("You owe suppliers", inr(it)) }
                        }
                    }
                }
                if (d.lowStock.isNotEmpty()) {
                    item {
                        SectionCard {
                            Text("Low stock", fontWeight = FontWeight.SemiBold)
                            d.lowStock.take(5).forEach { LabelValue(it.name, "${it.stock} ${it.unit} (reorder at ${it.reorderLevel})") }
                        }
                    }
                }
                if (d.recentDocuments.isNotEmpty()) {
                    item { Text("Recent", fontWeight = FontWeight.SemiBold) }
                    items(d.recentDocuments, key = { it.id }) { doc ->
                        Row(
                            Modifier.fillMaxWidth().clickable { openDocument(doc.id) }.padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(doc.partyName, maxLines = 1)
                                Text("${docLabel(doc.docType)} ${doc.number ?: "(draft)"} · ${dateIN(doc.issueDate)}", style = MaterialTheme.typography.bodySmall, color = Muted)
                            }
                            Column(horizontalAlignment = androidx.compose.ui.Alignment.End) {
                                Text(inr(doc.grandTotal))
                                StatusChip(doc.status, doc.isOverdue)
                            }
                        }
                    }
                }
            }
        }
    }
}
