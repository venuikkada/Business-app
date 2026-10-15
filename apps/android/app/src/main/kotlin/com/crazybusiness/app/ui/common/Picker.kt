package com.crazybusiness.app.ui.common

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * A read-only field that opens a list dialog. Used for states, payment methods,
 * GST rates and categories (simpler and more reliable on small phones than a
 * dropdown menu).
 */
@Composable
fun <T> PickerField(
    label: String,
    options: List<Pair<T, String>>,
    selected: T?,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    searchable: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    Box(modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = options.firstOrNull { it.first == selected }?.second ?: "",
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { Icon(Icons.Default.ArrowDropDown, null) },
            modifier = Modifier.fillMaxWidth(),
        )
        // Transparent overlay so taps anywhere on the field open the dialog.
        Box(Modifier.matchParentSize().clickable { open = true })
    }
    if (open) {
        val shown = if (query.isBlank()) options else options.filter { it.second.contains(query, ignoreCase = true) }
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text(label) },
            text = {
                androidx.compose.foundation.layout.Column {
                    if (searchable) FormField(query, { query = it }, "Search")
                    LazyColumn(Modifier.heightIn(max = 360.dp)) {
                        items(shown) { (value, text) ->
                            Text(
                                text,
                                Modifier.fillMaxWidth().clickable { onSelect(value); open = false; query = "" }.padding(vertical = 12.dp),
                            )
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { open = false }) { Text("Close") } },
        )
    }
}
