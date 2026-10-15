package com.crazybusiness.core

import com.crazybusiness.core.gst.GstCalculator
import com.crazybusiness.core.gst.GstCalculator.DiscountType
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.math.BigDecimal
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** Runs the same hand-verified vectors as packages/core/test/gst.test.ts. */
class GstVectorsTest {
    private val vectors = Json.parseToJsonElement(File(System.getProperty("cba.vectors")).readText()).jsonObject

    private fun dt(o: JsonObject, k: String) = o[k]?.jsonPrimitive?.content?.let { if (it == "percent") DiscountType.PERCENT else if (it == "amount") DiscountType.AMOUNT else null }
    private fun dec(o: JsonObject, k: String) = o[k]?.jsonPrimitive?.content?.let { BigDecimal(it) }

    private fun input(o: JsonObject) = GstCalculator.Input(
        lines = o["lines"]!!.jsonArray.map { it.jsonObject }.map { l ->
            GstCalculator.Line(dec(l, "quantity")!!, dec(l, "unitPrice")!!, dec(l, "taxRate")!!, dt(l, "discountType"), dec(l, "discountValue"))
        },
        pricesIncludeTax = o["pricesIncludeTax"]!!.jsonPrimitive.content.toBoolean(),
        isInterState = o["isInterState"]!!.jsonPrimitive.content.toBoolean(),
        roundOff = o["roundOff"]!!.jsonPrimitive.content.toBoolean(),
        documentDiscountType = dt(o, "documentDiscountType"),
        documentDiscountValue = dec(o, "documentDiscountValue"),
        additionalCharges = dec(o, "additionalCharges"),
        additionalChargesTaxRate = dec(o, "additionalChargesTaxRate") ?: BigDecimal.ZERO,
    )

    private fun field(r: Any, name: String): String {
        val getter = r::class.java.getMethod("get" + name.replaceFirstChar { it.uppercase() })
        return when (val v = getter.invoke(r)) {
            is BigDecimal -> if (name == "taxRate") v.stripTrailingZeros().toPlainString() else v.setScale(2).toPlainString()
            else -> v.toString()
        }
    }

    @Test
    fun sharedCasesMatch() {
        for (case in vectors["cases"]!!.jsonArray.map { it.jsonObject }) {
            val name = case["name"]!!.jsonPrimitive.content
            val r = GstCalculator.calculate(input(case["input"]!!.jsonObject))
            val expect = case["expect"]!!.jsonObject
            for ((k, v) in expect) {
                when (k) {
                    "lines" -> v.jsonArray.forEachIndexed { i, l -> l.jsonObject.forEach { (lk, lv) -> assertEquals(lv.jsonPrimitive.content, field(r.lines[i], lk), "$name line $i $lk") } }
                    "taxBreakup" -> v.jsonArray.forEachIndexed { i, b -> b.jsonObject.forEach { (bk, bv) -> assertEquals(bv.jsonPrimitive.content, field(r.taxBreakup[i], bk), "$name breakup $i $bk") } }
                    else -> assertEquals(v.jsonPrimitive.content, field(r, k), "$name $k")
                }
            }
        }
    }

    @Test
    fun sharedErrorsAreRejected() {
        for (case in vectors["errors"]!!.jsonArray.map { it.jsonObject }) {
            assertFailsWith<GstCalculator.CalculationException>(case["name"]!!.jsonPrimitive.content) { GstCalculator.calculate(input(case["input"]!!.jsonObject)) }
        }
    }

    @Test
    fun randomDocumentsAreInternallyConsistent() {
        val rnd = Random(42)
        val rates = listOf(0, 5, 12, 18, 28)
        repeat(500) {
            val lines = List(1 + rnd.nextInt(6)) {
                GstCalculator.Line(
                    BigDecimal(1 + rnd.nextInt(2000)).movePointLeft(2).add(BigDecimal.ONE),
                    BigDecimal(rnd.nextInt(500000)).movePointLeft(2),
                    BigDecimal(rates[rnd.nextInt(rates.size)]),
                    if (rnd.nextDouble() < 0.3) DiscountType.PERCENT else null,
                    BigDecimal(rnd.nextInt(2000)).movePointLeft(2),
                )
            }
            val inter = rnd.nextDouble() < 0.3
            val r = GstCalculator.calculate(GstCalculator.Input(lines, rnd.nextDouble() < 0.4, inter, rnd.nextDouble() < 0.7, if (rnd.nextDouble() < 0.3) DiscountType.PERCENT else null, BigDecimal(rnd.nextInt(1000)).movePointLeft(2), if (rnd.nextDouble() < 0.3) BigDecimal(rnd.nextInt(50000)).movePointLeft(2) else null, BigDecimal(18)))
            assertEquals(r.documentDiscount, r.lines.fold(BigDecimal.ZERO.setScale(2)) { a, l -> a + l.documentDiscountShare })
            assertEquals(r.totalBeforeRounding, r.taxableTotal + r.taxTotal)
            assertEquals(r.grandTotal, r.totalBeforeRounding + r.roundOff)
            if (inter) assertEquals(BigDecimal("0.00"), r.cgstTotal) else assertEquals(r.cgstTotal, r.sgstTotal)
            assertTrue(r.roundOff.abs() <= BigDecimal("0.50"))
        }
    }
}
