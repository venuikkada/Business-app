package com.crazybusiness.app.ui.inventory

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.crazybusiness.app.ui.common.BackBar
import com.crazybusiness.app.ui.common.EmptyState
import com.crazybusiness.app.ui.common.FormField
import com.crazybusiness.app.ui.common.LabelValue
import com.crazybusiness.app.ui.common.LoadView
import com.crazybusiness.app.ui.common.LocalContainer
import com.crazybusiness.app.ui.common.SectionCard
import com.crazybusiness.app.ui.common.inr
import com.crazybusiness.app.ui.common.rememberLoad
import com.crazybusiness.app.ui.theme.Danger
import com.crazybusiness.app.ui.theme.Muted
import java.math.BigDecimal

@Composable
fun ProductsScreen(openProduct: (String) -> Unit, openScanner: () -> Unit) {
    val c = LocalContainer.current
    var q by rememberSaveable { mutableStateOf("") }
    var low by rememberSaveable { mutableStateOf(false) }
    val data = rememberLoad(q, low) { c.api.products(q.ifBlank { null }, lowStock = low) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(start = 16.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            FormField(q, { q = it }, "Search items, SKU, barcode", Modifier.weight(1f))
            IconButton(onClick = openScanner) { Icon(Icons.Default.QrCodeScanner, "Scan barcode") }
        }
        Row(Modifier.padding(horizontal = 16.dp)) { FilterChip(selected = low, onClick = { low = !low }, label = { Text("Low stock only") }) }
        LoadView(data) { page ->
            if (page.items.isEmpty()) {
                EmptyState("No items found", "Add products and services from the web app, or import them from a CSV file.")
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    items(page.items, key = { it.id }) { p ->
                        Row(Modifier.fillMaxWidth().clickable { openProduct(p.id) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text(p.name, maxLines = 1)
                                Text(listOfNotNull(p.sku, p.categoryName, "GST ${BigDecimal(p.taxRate).stripTrailingZeros().toPlainString()}%").joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Muted)
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text(inr(p.sellingPrice))
                                if (p.trackInventory) Text("${p.stock ?: "0"} ${p.unit}", color = if (p.lowStock == true) Danger else Muted, style = MaterialTheme.typography.bodySmall)
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
fun ProductDetailScreen(id: String, onBack: () -> Unit) {
    val c = LocalContainer.current
    val ctx by c.context.collectAsState()
    val data = rememberLoad(id) { c.api.product(id) }
    Column(Modifier.fillMaxSize()) {
        BackBar("Item", onBack)
        LoadView(data) { p ->
            Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SectionCard {
                    Text(p.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    p.sku?.let { LabelValue("SKU", it) }
                    p.barcode?.let { LabelValue("Barcode", it) }
                    p.hsnCode?.let { LabelValue(if (p.type == "service") "SAC" else "HSN", it) }
                    LabelValue("Selling price", inr(p.sellingPrice) + if (p.pricesIncludeTax) " (incl. GST)" else " + GST")
                    LabelValue("GST rate", "${BigDecimal(p.taxRate).stripTrailingZeros().toPlainString()}%")
                    if (ctx?.can("financials.view") == true) p.costPrice?.let { LabelValue("Cost price", inr(it)) }
                    p.warrantyMonths?.let { LabelValue("Warranty", "$it months") }
                    p.matchedSerial?.let { LabelValue("Scanned serial", it, bold = true) }
                }
                if (p.trackInventory) {
                    SectionCard {
                        Text("Stock", fontWeight = FontWeight.SemiBold)
                        p.stock.forEach { LabelValue(it.branchName, "${it.quantity} ${p.unit}") }
                        if (p.stock.size > 1) LabelValue("Total", "${p.totalStock.stripTrailingZeros().toPlainString()} ${p.unit}", bold = true)
                        Text("Adjust stock or transfer between branches from the web app (every change is recorded).", style = MaterialTheme.typography.bodySmall, color = Muted)
                    }
                }
            }
        }
    }
}
