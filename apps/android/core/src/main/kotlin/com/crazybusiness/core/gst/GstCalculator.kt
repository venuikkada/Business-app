package com.crazybusiness.core.gst

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Kotlin port of the TypeScript GST engine (packages/core/src/gst.ts).
 * Both engines are tested against test-vectors/gst.json so the Android app's
 * live totals always match what the server stores. The server remains the
 * source of truth: it recomputes every document on save.
 */
object GstCalculator {
    val SUPPORTED_RATES: List<BigDecimal> = listOf("0", "0.1", "0.25", "1.5", "3", "5", "6", "7.5", "12", "18", "28", "40").map(::BigDecimal)
    val COMMON_RATES: List<Int> = listOf(0, 5, 12, 18, 28)

    private val ZERO = BigDecimal.ZERO
    private val HUNDRED = BigDecimal(100)

    enum class DiscountType { PERCENT, AMOUNT }

    data class Line(
        val quantity: BigDecimal,
        val unitPrice: BigDecimal,
        val taxRate: BigDecimal,
        val discountType: DiscountType? = null,
        val discountValue: BigDecimal? = null,
    )

    data class Input(
        val lines: List<Line>,
        val pricesIncludeTax: Boolean,
        val isInterState: Boolean,
        val roundOff: Boolean,
        val documentDiscountType: DiscountType? = null,
        val documentDiscountValue: BigDecimal? = null,
        val additionalCharges: BigDecimal? = null,
        val additionalChargesTaxRate: BigDecimal = ZERO,
    )

    data class LineResult(
        val gross: BigDecimal,
        val lineDiscount: BigDecimal,
        val documentDiscountShare: BigDecimal,
        val taxableValue: BigDecimal,
        val taxRate: BigDecimal,
        val cgst: BigDecimal,
        val sgst: BigDecimal,
        val igst: BigDecimal,
        val taxAmount: BigDecimal,
        val total: BigDecimal,
    )

    data class TaxBreakup(val taxRate: BigDecimal, val taxableValue: BigDecimal, val cgst: BigDecimal, val sgst: BigDecimal, val igst: BigDecimal, val taxAmount: BigDecimal)

    data class Result(
        val lines: List<LineResult>,
        val grossTotal: BigDecimal,
        val lineDiscountTotal: BigDecimal,
        val documentDiscount: BigDecimal,
        val discountTotal: BigDecimal,
        val additionalCharges: BigDecimal,
        val additionalChargesTax: BigDecimal,
        val taxableTotal: BigDecimal,
        val cgstTotal: BigDecimal,
        val sgstTotal: BigDecimal,
        val igstTotal: BigDecimal,
        val taxTotal: BigDecimal,
        val totalBeforeRounding: BigDecimal,
        val roundOff: BigDecimal,
        val grandTotal: BigDecimal,
        val taxBreakup: List<TaxBreakup>,
    )

    class CalculationException(message: String, val field: String? = null) : IllegalArgumentException(message)

    fun r2(v: BigDecimal): BigDecimal = v.setScale(2, RoundingMode.HALF_UP)

    private fun assertRate(rate: BigDecimal, field: String) {
        if (SUPPORTED_RATES.none { it.compareTo(rate) == 0 }) throw CalculationException("Unsupported GST rate ${rate.stripTrailingZeros().toPlainString()}%", field)
    }

    private data class Tax(val taxable: BigDecimal, val cgst: BigDecimal, val sgst: BigDecimal, val igst: BigDecimal)

    private fun taxOn(amount: BigDecimal, rate: BigDecimal, inclusive: Boolean, inter: Boolean): Tax {
        val taxable = if (inclusive) r2(amount.multiply(HUNDRED).divide(rate.add(HUNDRED), 20, RoundingMode.HALF_UP)) else r2(amount)
        return if (inter) {
            Tax(taxable, r2(ZERO), r2(ZERO), r2(taxable.multiply(rate).divide(HUNDRED, 20, RoundingMode.HALF_UP)))
        } else {
            val half = r2(taxable.multiply(rate).divide(BigDecimal(200), 20, RoundingMode.HALF_UP))
            Tax(taxable, half, half, r2(ZERO))
        }
    }

    /** Largest-remainder allocation so the parts always sum exactly to [total]. */
    fun allocate(total: BigDecimal, weights: List<BigDecimal>): List<BigDecimal> {
        if (weights.isEmpty()) return emptyList()
        val totalPaise = r2(total).movePointRight(2)
        val sum = weights.fold(ZERO, BigDecimal::add)
        if (sum.signum() == 0) return weights.map { r2(ZERO) }
        val raw = weights.map { totalPaise.multiply(it).divide(sum, 20, RoundingMode.HALF_UP) }
        val floors = raw.map { it.setScale(0, RoundingMode.FLOOR) }.toMutableList()
        var remaining = totalPaise.subtract(floors.fold(ZERO, BigDecimal::add)).toInt()
        val order = raw.indices.sortedWith(compareByDescending<Int> { raw[it].subtract(raw[it].setScale(0, RoundingMode.FLOOR)) }.thenBy { it })
        var k = 0
        while (remaining > 0 && k < order.size) {
            floors[order[k]] = floors[order[k]].add(BigDecimal.ONE)
            remaining--
            k++
        }
        return floors.map { r2(it.movePointLeft(2)) }
    }

    fun calculate(input: Input): Result {
        val inclusive = input.pricesIncludeTax
        val inter = input.isInterState
        data class Prep(val gross: BigDecimal, val discount: BigDecimal, val net: BigDecimal, val rate: BigDecimal)

        val prepared = input.lines.mapIndexed { i, l ->
            val n = i + 1
            if (l.quantity.signum() <= 0) throw CalculationException("Line $n: quantity must be greater than 0", "lines.$i.quantity")
            if (l.quantity.stripTrailingZeros().scale() > 3) throw CalculationException("Line $n: quantity allows at most 3 decimals", "lines.$i.quantity")
            if (l.unitPrice.signum() < 0) throw CalculationException("Line $n: price cannot be negative", "lines.$i.unitPrice")
            if (l.unitPrice.stripTrailingZeros().scale() > 2) throw CalculationException("Line $n: price allows at most 2 decimals", "lines.$i.unitPrice")
            assertRate(l.taxRate, "lines.$i.taxRate")
            val gross = r2(l.quantity.multiply(l.unitPrice))
            val dv = l.discountValue ?: ZERO
            if (dv.signum() < 0) throw CalculationException("Line $n: discount cannot be negative", "lines.$i.discountValue")
            val discount = when (l.discountType) {
                DiscountType.PERCENT -> {
                    if (dv > HUNDRED) throw CalculationException("Line $n: discount cannot exceed 100%", "lines.$i.discountValue")
                    r2(gross.multiply(dv).divide(HUNDRED, 20, RoundingMode.HALF_UP))
                }
                DiscountType.AMOUNT -> {
                    if (r2(dv) > gross) throw CalculationException("Line $n: discount cannot exceed line amount", "lines.$i.discountValue")
                    r2(dv)
                }
                null -> r2(ZERO)
            }
            Prep(gross, discount, gross.subtract(discount), l.taxRate)
        }
        val netSum = prepared.fold(ZERO) { a, p -> a.add(p.net) }
        val ddv = input.documentDiscountValue ?: ZERO
        if (ddv.signum() < 0) throw CalculationException("Document discount cannot be negative", "documentDiscountValue")
        val documentDiscount = when (input.documentDiscountType) {
            DiscountType.PERCENT -> {
                if (ddv > HUNDRED) throw CalculationException("Document discount cannot exceed 100%", "documentDiscountValue")
                r2(netSum.multiply(ddv).divide(HUNDRED, 20, RoundingMode.HALF_UP))
            }
            DiscountType.AMOUNT -> r2(ddv).also { if (it > netSum) throw CalculationException("Document discount cannot exceed the subtotal", "documentDiscountValue") }
            null -> r2(ZERO)
        }
        val shares = allocate(documentDiscount, prepared.map { it.net })

        val lines = prepared.mapIndexed { i, p ->
            val after = p.net.subtract(shares[i])
            val t = taxOn(after, p.rate, inclusive, inter)
            val tax = t.cgst.add(t.sgst).add(t.igst)
            LineResult(p.gross, p.discount, shares[i], t.taxable, p.rate, t.cgst, t.sgst, t.igst, tax, t.taxable.add(tax))
        }

        val charges = r2(input.additionalCharges ?: ZERO)
        if (charges.signum() < 0) throw CalculationException("Additional charges cannot be negative", "additionalCharges")
        assertRate(input.additionalChargesTaxRate, "additionalChargesTaxRate")
        val ct = taxOn(charges, input.additionalChargesTaxRate, false, inter)
        val chargesTax = ct.cgst.add(ct.sgst).add(ct.igst)

        fun sum(f: (LineResult) -> BigDecimal) = lines.fold(r2(ZERO)) { a, l -> a.add(f(l)) }
        val cgst = sum { it.cgst }.add(ct.cgst)
        val sgst = sum { it.sgst }.add(ct.sgst)
        val igst = sum { it.igst }.add(ct.igst)
        val taxTotal = cgst.add(sgst).add(igst)
        val taxable = sum { it.taxableValue }.add(charges)
        val before = taxable.add(taxTotal)
        val grand = if (input.roundOff) before.setScale(0, RoundingMode.HALF_UP).setScale(2) else before
        val lineDiscountTotal = sum { it.lineDiscount }

        val breakup = linkedMapOf<BigDecimal, Array<BigDecimal>>()
        fun add(rate: BigDecimal, tv: BigDecimal, c: BigDecimal, s: BigDecimal, ig: BigDecimal) {
            val key = rate.stripTrailingZeros()
            val cur = breakup.getOrPut(key) { arrayOf(r2(ZERO), r2(ZERO), r2(ZERO), r2(ZERO)) }
            cur[0] = cur[0].add(tv); cur[1] = cur[1].add(c); cur[2] = cur[2].add(s); cur[3] = cur[3].add(ig)
        }
        lines.forEach { add(it.taxRate, it.taxableValue, it.cgst, it.sgst, it.igst) }
        if (charges.signum() > 0) add(input.additionalChargesTaxRate, charges, ct.cgst, ct.sgst, ct.igst)
        val taxBreakup = breakup.entries.sortedBy { it.key }.map { (rate, v) -> TaxBreakup(rate, v[0], v[1], v[2], v[3], v[1].add(v[2]).add(v[3])) }

        return Result(
            lines = lines,
            grossTotal = sum { it.gross },
            lineDiscountTotal = lineDiscountTotal,
            documentDiscount = documentDiscount,
            discountTotal = lineDiscountTotal.add(documentDiscount),
            additionalCharges = charges,
            additionalChargesTax = chargesTax,
            taxableTotal = taxable,
            cgstTotal = cgst,
            sgstTotal = sgst,
            igstTotal = igst,
            taxTotal = taxTotal,
            totalBeforeRounding = before,
            roundOff = grand.subtract(before),
            grandTotal = grand,
            taxBreakup = taxBreakup,
        )
    }
}
