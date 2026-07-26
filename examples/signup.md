---
title: Signup rejects a bad email without saying where
origin: https://northlane-demo.vercel.app
---

A short signup flow, recorded against a public demo site — so this plan runs as-is,
with nothing to install and nothing to log into.

1. open /signup/ — The Northlane signup form
2. type #email "alex@" — Typing an address that isn't valid
3. type #company "Northwind Trading" — Filling in the company
4. click button[type="submit"] — Submitting the form
5. check #formnote — The complaint lands at the bottom of the form, not next to the field
