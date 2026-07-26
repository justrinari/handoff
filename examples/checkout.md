---
title: Checkout now validates the address
origin: https://northlane-demo.vercel.app
---

A longer flow: pick a plan, fill in three fields, place the order, confirm the receipt.
Same public demo site as signup.md, so this one also runs as-is.

1. open / — Northlane pricing, where a customer picks a plan
2. click a[href="/checkout/"] — Opening checkout for Northlane Pro
3. type #name "Alex Moreau" — Filling in the billing name
4. type #street "12 Rue des Lilas" — Street address
5. type #city "Lyon, 69003" — City and postcode
6. click #place — Placing the order
7. check #checkoutnote — The order goes through and the receipt is confirmed
