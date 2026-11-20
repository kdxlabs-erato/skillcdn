# ADR-0114: A name joined by capitals is found by its words where it names something

- Status: Accepted
- Date: 2026-11-20
- Builds on [ADR-0069](0069-a-word-of-a-query-weighs-by-its-rarity-among-the-entries-searched.md), [ADR-0078](0078-a-word-joined-by-slashes-or-dots-is-a-word-beside-its-parts.md) and [ADR-0100](0100-a-name-joined-by-underscores-is-a-word-and-a-documents-sections-are-ranked-by-a-words-rarity-among-them.md) (a code, a token joined by slashes or dots and a name joined by underscores are each a word beside their parts).

## Context

The reference of a library names its things by capitals: `BerthAssigned`, `AllowPilotToReorderBerths`, `XMLReader`. The text is put in small letters before it is cut into words, so such a name was one word, `berthassigned`, and nothing else. Whoever knows the name finds it. Whoever does not, a person or a model that asks for "berth assigned", found nothing of the page that the name heads, and a model that cannot find a name invents one.

Measured on a pack of 1,814 pages of one library's reference, by words alone, with 17 questions that name an API and 18 that say the task in words, and with the 8 searches a model typed when it did not know one event's name:

| The words a name is joined of are read | Named: first | among five | In words: first | among five | among ten | The 8 searches: among ten |
|---|---|---|---|---|---|---|
| nowhere (as it was) | 14 | 16 | 7 | 12 | 13 | 1 |
| in names, titles, paths and headings, at the weight of the field | 14 | 15 | 9 | 14 | 16 | 3 |
| there, at the weight of a heading at most | 14 | 16 | 8 | 12 | 14 | 1 |
| there, at the weight of the body | 14 | 16 | 9 | 12 | 14 | 1 |

The pages that the words now find are the ones whose title is the name. A trial before this one, which wrote the words into a copy of the pack, had found that reading them in the body as well loses the gain, the words of a few names being in thousands of bodies, and that reading them in a query moves three questions that name an API from the first place. The two evaluation sets of this repository, which hold no such names, measure the same before and after: 95% and 57% of the first documents.

## Decision

1. **A name joined by capitals is a word beside the words it is joined of, where it names something**: in the name and the title of an entry, in the words of its path and in the headings of its body, and in the headings a document's sections are ranked by. The name is a word as written, as before; its words follow it, read as words are, stemmed and without the stop words, at the weight of the field.
2. **Capitals join words at three places**: a small letter before a capital (`berthAssigned`), a run of capitals before a capitalized word (`XMLReader`, `IOError`), and a digit before one (`Base64Encode`). Digits stay with the word before them (`utf8`, `x509`). A word, a capitalized word, a word in capitals and a code of capitals and digits (`E214`, `HTTP2`) have no such place and are read as before. A part of one letter or of digits alone is no word.
3. **The body is not read so, and neither is a query.** A name in running text is one word; a name asked for matches the name whole, and a question in words matches the words of the names that head a page or a section.
4. **Only letters that have a case, in a run of at most 128 characters**, and only where the text takes as much room in small letters as it does written, so that the place of a run is the same in both.
5. **The reading rules have a new version** (`INDEX_VERSION` 19), since the vector of an entry changes: a commit indexed under the rules before is rebuilt, and served from the index it has until it is (ADR-0068). The vectors of its sections are kept by their text (ADR-0093), so nothing is embedded again.

## Consequences

- **A page named by an API is found by a question in words** where only the words answer, which is every pack served without a model and every query the words rank alone (ADR-0079).
- **One question that names an API fell from the fourth place to the seventh**: it asks for a property whose name is also a word of its class's name, and every page of that class now holds the word in its title. No question in words fell.
- **A product's name is read the same way**: a heading with `JavaScript` holds `java` and `script`. A word weighs by its rarity among the entries searched (ADR-0069), and the body is not read so, which bounds what this costs; the two evaluation sets did not move.
- **Not measured**: how many of the questions in words a search by meaning already answers on that pack. Where it does, the words still rank beside it.
- **Rejected:**
  - reading the words in the body as well: the gain is lost;
  - reading the words of a name in a query: the questions that name an API lose their first place;
  - a lower weight for the words than for the name: at a heading's weight or the body's, one more question in words is answered among ten and none among five;
  - joining the words of a query into one, so that "berth assigned" also asks for `berthassigned`: it needs no new index, and finds a name only when every word of it is said and in its order.
