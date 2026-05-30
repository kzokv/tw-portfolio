#!/usr/bin/env python3
"""
Deterministic Taiwan trade cash-flow calculator for bookkeeping.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from decimal import Decimal, ROUND_HALF_UP, getcontext

getcontext().prec = 28

TWOPLACES = Decimal("0.01")
FOURPLACES = Decimal("0.0001")
DEFAULT_COMMISSION_RATE = Decimal("0.001425")


def parse_decimal(value: str) -> Decimal:
    return Decimal(str(value))


def quantize_money(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def quantize_rate(value: Decimal) -> Decimal:
    return value.quantize(FOURPLACES, rounding=ROUND_HALF_UP)


@dataclass
class CalculationResult:
    instrument: str
    side: str
    quantity: str | None
    unit_price: str | None
    gross_amount: str
    commission_amount: str
    transaction_tax_rate: str
    transaction_tax_amount: str
    net_cash: str
    commission_mode: str
    assumptions: dict[str, object]


def resolve_gross_amount(quantity: Decimal | None, unit_price: Decimal | None, gross_amount: Decimal | None) -> Decimal:
    if gross_amount is not None:
        return quantize_money(gross_amount)
    if quantity is None or unit_price is None:
        raise ValueError("provide --gross-amount or both --quantity and --unit-price")
    return quantize_money(quantity * unit_price)


def resolve_commission(
    gross_amount: Decimal,
    commission_amount: Decimal | None,
    commission_rate: Decimal | None,
    commission_discount: Decimal | None,
    minimum_commission: Decimal | None,
) -> tuple[Decimal, str, dict[str, object]]:
    if commission_amount is not None:
        return quantize_money(commission_amount), "explicit", {"commission_amount_source": "statement_or_user_provided"}

    rate = commission_rate if commission_rate is not None else DEFAULT_COMMISSION_RATE
    discount = commission_discount if commission_discount is not None else Decimal("1")
    minimum = minimum_commission if minimum_commission is not None else Decimal("0")

    effective_rate = rate * discount
    calculated = gross_amount * effective_rate
    applied = calculated if calculated >= minimum else minimum

    return (
        quantize_money(applied),
        "assumed",
        {
            "commission_rate": str(quantize_rate(rate)),
            "commission_discount": str(quantize_rate(discount)),
            "effective_commission_rate": str(quantize_rate(effective_rate)),
            "minimum_commission": str(quantize_money(minimum)),
        },
    )


def resolve_transaction_tax_rate(instrument: str, side: str, day_trade: bool) -> Decimal:
    if side == "buy":
        return Decimal("0")
    if instrument == "stock":
        return Decimal("0.0015") if day_trade else Decimal("0.003")
    if instrument == "etf":
        return Decimal("0.001")
    if instrument == "bond-etf":
        return Decimal("0")
    raise ValueError(f"unsupported instrument: {instrument}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Calculate Taiwan trade cash flow for bookkeeping.")
    parser.add_argument("--instrument", required=True, choices=["stock", "etf", "bond-etf"])
    parser.add_argument("--side", required=True, choices=["buy", "sell"])
    parser.add_argument("--quantity", type=parse_decimal)
    parser.add_argument("--unit-price", type=parse_decimal)
    parser.add_argument("--gross-amount", type=parse_decimal)
    parser.add_argument("--commission-amount", type=parse_decimal)
    parser.add_argument("--commission-rate", type=parse_decimal)
    parser.add_argument("--commission-discount", type=parse_decimal)
    parser.add_argument("--minimum-commission", type=parse_decimal)
    parser.add_argument("--day-trade", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()

    gross_amount = resolve_gross_amount(args.quantity, args.unit_price, args.gross_amount)
    commission_amount, commission_mode, assumptions = resolve_commission(
        gross_amount=gross_amount,
        commission_amount=args.commission_amount,
        commission_rate=args.commission_rate,
        commission_discount=args.commission_discount,
        minimum_commission=args.minimum_commission,
    )

    tax_rate = resolve_transaction_tax_rate(args.instrument, args.side, args.day_trade)
    tax_amount = quantize_money(gross_amount * tax_rate)

    if args.side == "buy":
        net_cash = gross_amount + commission_amount
    else:
        net_cash = gross_amount - commission_amount - tax_amount

    result = CalculationResult(
        instrument=args.instrument,
        side=args.side,
        quantity=str(args.quantity) if args.quantity is not None else None,
        unit_price=str(args.unit_price) if args.unit_price is not None else None,
        gross_amount=str(gross_amount),
        commission_amount=str(commission_amount),
        transaction_tax_rate=str(quantize_rate(tax_rate)),
        transaction_tax_amount=str(tax_amount),
        net_cash=str(quantize_money(net_cash)),
        commission_mode=commission_mode,
        assumptions=assumptions,
    )

    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
