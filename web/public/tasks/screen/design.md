# Screen design

Pooled CRISPR knockout screen (synthetic data).

- Library: 2000 genes x 4 sgRNAs + 200 non-targeting controls (`NON_TARGETING`).
- Cells were transduced at low MOI, selected, and a `day0` sample was taken.
- Cells were then split into two arms for 14 days:
  - `treat_rep1`, `treat_rep2`: helixin (a DNA alkylating agent) at IC70
  - `ctrl_rep1`, `ctrl_rep2`: vehicle (DMSO)
- `plasmid` is the sequenced library plasmid pool.
- Target representation: >= 200 reads per sgRNA for every sample.

Files
- `counts.tsv`: raw sgRNA read counts. Columns: sgRNA, gene, plasmid, day0, treat_rep1, treat_rep2, ctrl_rep1, ctrl_rep2
- `samples.tsv`: sample sheet
- `pathways.gmt`: gene sets (GMT format: name, description, genes...)
- `common_essentials.txt`: a public reference list of pan-cancer common essential genes (one per line)

Conventions
- "Resistance" genes: knockout is ENRICHED in treatment relative to vehicle control.
- "Sensitizer" genes: knockout is DEPLETED in treatment relative to vehicle control.
