---
"@skillcdn/core": patch
---

`joinSkillPages` joins the pages of a skill that includes several files into one text per file. Each page names every included file, one not reached yet as an empty cut fragment, and the fragments of one file were joined only when they stood next to each other. A skill with two or more included files read in several pages came out with each file's heading repeated, with nothing under it, and sentences broken across the seams. `skillcdn skill` printed it so.
