package com.crazybusiness.app.ui.sales

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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.crazybusiness.app.ui.common.EmptyState
import com.crazybusiness.app.ui.common.FormField
import com.crazybusiness.app.ui.common.LoadView
import com.crazybusiness.app.ui.common.LocalContainer
import com.crazybusiness.app.ui.common.StatusChip
import com.crazybusiness.app.ui.common.dateIN
import com.crazybusiness.app.ui.common.inr
import com.crazybusiness.app.ui.common.rememberLoad
import com.crazybusiness.app.ui.theme.Muted

private val TYPES = listOf("invoice" to "Invoices", "quotation" to "Quotations", "credit_note" to "Credit notes")

@Composable
fun DocumentsScreen(openDocument: (String) -> Unit, create: (String) -> Unit) {
    val c = LocalContainer.current
    var tab by rememberSaveable { mutableStateOf(0) }
    var q by rememberSaveable { mutableStateOf("") }
    val type = TYPES[tab].first
    val data = rememberLoad(type, q) { c.api.documents(type, q = q.ifBlank { null }) }

    Scaffold(
        floatingActionButton = {
            if (type != "credit_note") ExtendedFloatingActionButton(onClick = { create(type) }, icon = { Icon(Icons.Default.Add, null) }, text = { Text(if (type == "invoice") "New invoice" else "New quotation") })
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            TabRow(selectedTabIndex = tab) {
                TYPES.forEachIndexed { i, (_, label) -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) }) }
            }
            FormField(q, { q = it }, "Search number or customer", Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            LoadView(data) { res ->
                if (res.items.isEmpty()) {
                    EmptyState("Nothing here yet", if (type == "credit_note") "Create a credit note from an invoice on the web app." else "Tap + to create your first one.")
                } else {
                    LazyColumn(Modifier.fillMaxSize()) {
                        res.sumBalance?.let {
                            item { Text("${res.total} documents · ${inr(it)} pending", color = Muted, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
                        }
                        items(res.items, key = { it.id }) { d ->
                            Row(
                                Modifier.fillMaxWidth().clickable { openDocument(d.id) }.padding(horizontal = 16.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(d.partyName, maxLines = 1)
                                    Text("${d.number ?: "Draft"} · ${dateIN(d.issueDate)}", style = MaterialTheme.typography.bodySmall, color = Muted)
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(inr(d.grandTotal))
                                    StatusChip(d.status, d.isOverdue)
                                }
                            }
                            HorizontalDivider()
                        }
                    }
                }
            }
        }
    }
}
