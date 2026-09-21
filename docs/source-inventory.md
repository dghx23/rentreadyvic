# Source inventory

This file records how the recovered RentReady files were imported into this repository.

| Original source | SHA-256 | Repository destination | Notes |
|---|---|---|---|
| `Pasted text(4).txt` | `58cf969a13c604d07679f73bdc600132ac31169370d0f1320816e5cb77691a29` | `index.html` | Newest integrated prototype; canonical working source. |
| `Pasted text (2).txt` | `1ba63a3549c143de274395d60b77cde2d226f200cd5aaa6db1375b1293629aba` | `archive/rentready-prototype-v2.html` | Earlier full prototype. |
| `RentReady-VIC-current.html` | `1ba63a3549c143de274395d60b77cde2d226f200cd5aaa6db1375b1293629aba` | not duplicated | Byte-identical to `Pasted text (2).txt`. |
| `deepseek_html_20260921_82a73c.html` | `1ba63a3549c143de274395d60b77cde2d226f200cd5aaa6db1375b1293629aba` | not duplicated | Byte-identical to `Pasted text (2).txt`. |
| `Pasted text (3).txt` | `b23a8f029a52b809c25b8e7dcce071cc022ebd44612dd844eba1b130ac16c1da` | `archive/rentready-prototype-v1.html` | Older toolkit prototype. |
| `deepseek_text_20260921_2d57a2(1).txt` | `938b614ee0ba351411d5327e942c732f56669f940e61d0f86bf386e25294bbf6` | `docs/original-structure.txt` | Proposed multi-file site structure. |

## Integrity verification

The imported HTML blobs were checked against the original byte sizes after commit:

- `index.html`: 196,575 bytes
- `archive/rentready-prototype-v2.html`: 162,606 bytes
- `archive/rentready-prototype-v1.html`: 128,961 bytes

Duplicate files were deliberately not committed multiple times.
