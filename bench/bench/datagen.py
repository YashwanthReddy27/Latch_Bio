"""Seeded synthetic pooled CRISPR knockout screen.

Design: a genome-wide-style library (~2,000 genes x 4 sgRNAs + 200 non-targeting
controls) screened with a fictional alkylating agent ("helixin") vs vehicle.

Samples: plasmid, day0, treat_rep1, treat_rep2, ctrl_rep1, ctrl_rep2.

Planted ground truth (written to data/truth.json, never shown to agents):
  * 148 core-essential genes depleted in BOTH arms (ribosome, proteasome, ...)
  * 12 resistance hits (enriched in treatment only), 7 of them mismatch repair
  * 18 sensitizer hits (depleted in treatment only), mostly HR / Fanconi / TLS
  * per-guide efficacy noise and ~6% near-dead guides
  * treat_rep2 went through a cell bottleneck -> low coverage, high Gini, dropouts
  * 40 guides failed synthesis -> zero reads everywhere

Biology is loosely modelled on temozolomide screens (MMR loss -> resistance,
HR/FA/TLS loss -> sensitization) but the numbers are entirely synthetic.

Run:  python -m bench.datagen
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from . import DATA_DIR, SCREEN_DIR

SEED = 20261014
N_GENES = 2000
GUIDES_PER_GENE = 4
N_NTC = 200
N_FAILED_SYNTHESIS = 40
BOTTLENECK_SAMPLE = "treat_rep2"
SAMPLES = ["plasmid", "day0", "treat_rep1", "treat_rep2", "ctrl_rep1", "ctrl_rep2"]
DEPTH = {  # total reads per sample
    "plasmid": 4_000_000,
    "day0": 3_600_000,
    "treat_rep1": 6_500_000,  # 2x the controls: un-normalized LFCs shift by ~+1
    "treat_rep2": 900_000,  # bottlenecked + shallow
    "ctrl_rep1": 3_200_000,
    "ctrl_rep2": 3_000_000,
}
NB_ALPHA = 0.02  # technical over-dispersion of read counts
BIO_NOISE_SD = 0.22  # per-guide, per-replicate log2 noise in endpoint samples
BOTTLENECK_CELLS_PER_GUIDE = 5

CORE_ESSENTIAL = (
    "RPL3 RPL4 RPL5 RPL6 RPL7 RPL7A RPL8 RPL9 RPL10 RPL10A RPL11 RPL12 RPL13 RPL13A RPL14 "
    "RPL15 RPL17 RPL18 RPL18A RPL19 RPL21 RPL23 RPL23A RPL24 RPL26 RPL27 RPL27A RPL28 RPL29 "
    "RPL30 RPL31 RPL32 RPL34 RPL35 RPL35A RPL36 RPL37 RPL37A RPL38 "
    "RPS2 RPS3 RPS3A RPS4X RPS5 RPS6 RPS7 RPS8 RPS9 RPS11 RPS12 RPS13 RPS14 RPS15 RPS15A "
    "RPS16 RPS18 RPS19 RPS20 RPS21 RPS23 RPS24 RPS25 RPS26 RPS27A RPS28 RPS29 "
    "PSMA1 PSMA2 PSMA3 PSMA4 PSMA5 PSMA6 PSMA7 PSMB1 PSMB2 PSMB3 PSMB4 PSMB5 PSMB6 PSMB7 "
    "PSMC1 PSMC2 PSMC3 PSMC4 PSMC5 PSMC6 PSMD1 PSMD2 PSMD3 PSMD4 PSMD6 PSMD7 PSMD8 PSMD11 "
    "PSMD12 PSMD14 "
    "POLR2A POLR2B POLR2C POLR2D POLR2E POLR2F POLR2G POLR2H POLR2I POLR2J POLR2L "
    "SF3B1 SF3B2 SF3B3 SF3A1 SF3A3 SNRPD1 SNRPD2 SNRPD3 SNRPE SNRPF PRPF8 PRPF19 U2AF1 U2AF2 "
    "CDK1 PLK1 AURKB MCM2 MCM3 MCM4 MCM5 MCM6 MCM7 PCNA RFC2 RFC4 POLA1 POLD1 POLE RRM1 RRM2 "
    "KIF11 CCNA2 BUB1B "
    "EIF2S1 EIF3A EIF3B EIF3D EIF4A3 EEF2 EEF1A1"
).split()

RESISTANCE_HITS = "MLH1 MSH2 MSH6 PMS2 PMS1 EXO1 MLH3 SLFN11 TP53 BAX CDKN1A APAF1".split()
SENSITIZER_HITS = (
    "MGMT BRCA1 BRCA2 PALB2 RAD51C RAD51D XRCC2 XRCC3 FANCA FANCD2 FANCI FANCL UBE2T "
    "RAD18 REV1 REV3L XRCC1 POLB"
).split()

# Curated pathway gene sets (real symbols). Decoy sets are padded with filler genes.
PATHWAYS: dict[str, list[str]] = {
    "RIBOSOME": [g for g in CORE_ESSENTIAL if g.startswith("RP")],
    "PROTEASOME": [g for g in CORE_ESSENTIAL if g.startswith("PSM")],
    "SPLICEOSOME": "SF3B1 SF3B2 SF3B3 SF3A1 SF3A3 SNRPD1 SNRPD2 SNRPD3 SNRPE SNRPF PRPF8 PRPF19 U2AF1 U2AF2".split(),
    "DNA_REPLICATION": "MCM2 MCM3 MCM4 MCM5 MCM6 MCM7 PCNA RFC2 RFC4 POLA1 POLD1 POLE RRM1 RRM2 LIG1 POLD3 RPA2 RPA3".split(),
    "MISMATCH_REPAIR": "MLH1 MSH2 MSH6 PMS2 MSH3 EXO1 PMS1 MLH3 LIG1 POLD3 RPA2 RPA3".split(),
    "HOMOLOGOUS_RECOMBINATION": "BRCA1 BRCA2 PALB2 RAD51B RAD51C RAD51D XRCC2 XRCC3 RAD54L BARD1 MRE11 RAD50 NBN BRIP1".split(),
    "FANCONI_ANEMIA": "FANCA FANCB FANCC FANCD2 FANCE FANCF FANCG FANCI FANCL FANCM UBE2T".split(),
    "TRANSLESION_SYNTHESIS": "RAD18 POLK POLH POLI REV1 REV3L MAD2L2 UBE2A".split(),
    "BASE_EXCISION_REPAIR": "MPG APEX1 XRCC1 POLB LIG3 PARP1 UNG NTHL1 OGG1".split(),
    "DIRECT_DAMAGE_REVERSAL": "MGMT ALKBH2 ALKBH3".split(),
    "P53_APOPTOSIS": "TP53 BAX CDKN1A APAF1 BBC3 PMAIP1 CASP9 CASP3 BAK1 MDM2".split(),
    "MTOR_SIGNALING": "MTOR RPTOR RICTOR MLST8 AKT1S1 TSC1 TSC2 RHEB DEPTOR".split(),
    "HIPPO_SIGNALING": "YAP1 WWTR1 LATS1 LATS2 STK3 STK4 SAV1 MOB1A NF2 TEAD1".split(),
    "NFKB_SIGNALING": "NFKB1 RELA RELB IKBKB CHUK IKBKG TNFAIP3 NFKBIA".split(),
    "INTERFERON_SIGNALING": "IFNAR1 IFNAR2 JAK1 TYK2 STAT1 STAT2 IRF9".split(),
    "PEROXISOME": "PEX1 PEX2 PEX3 PEX5 PEX6 PEX7 PEX10 PEX12 PEX13 PEX14 PEX16 PEX19".split(),
    "GOLGI_TRANSPORT": "COG1 COG2 COG3 COG4 COG5 COG6 COG7 COG8".split(),
    "NRF2_OXIDATIVE_STRESS": "KEAP1 NFE2L2 CUL3 SQSTM1 NQO1 HMOX1 GCLC GCLM".split(),
}
DECOY_PADDING = {  # filler genes added so set sizes look realistic
    "MTOR_SIGNALING": 20, "HIPPO_SIGNALING": 18, "NFKB_SIGNALING": 22,
    "INTERFERON_SIGNALING": 25, "PEROXISOME": 15, "GOLGI_TRANSPORT": 22,
    "NRF2_OXIDATIVE_STRESS": 20, "P53_APOPTOSIS": 10, "BASE_EXCISION_REPAIR": 6,
    "SPLICEOSOME": 10,
}
N_MILD_FITNESS = 100  # filler genes with weak fitness defects (not "core essential")


def _gamma_poisson(rng: np.random.Generator, mean: np.ndarray, alpha: float) -> np.ndarray:
    lam = rng.gamma(shape=1.0 / alpha, scale=mean * alpha)
    return rng.poisson(lam)


def generate(seed: int = SEED) -> tuple[pd.DataFrame, dict]:
    rng = np.random.default_rng(seed)

    named = list(dict.fromkeys(
        CORE_ESSENTIAL + RESISTANCE_HITS + SENSITIZER_HITS
        + [g for genes in PATHWAYS.values() for g in genes]
    ))
    n_filler = N_GENES - len(named)
    filler = [f"HX{i:04d}" for i in range(1, n_filler + 1)]
    genes = named + filler
    assert len(genes) == N_GENES

    pathways = {k: list(v) for k, v in PATHWAYS.items()}
    pool = list(rng.permutation(filler))
    for name, pad in DECOY_PADDING.items():
        pathways[name] += sorted(pool[:pad])
        pool = pool[pad:]
    mild_fitness = sorted(pool[:N_MILD_FITNESS])

    # gene-level effects (log2 fold change over the screen)
    ess_effect = {g: 0.0 for g in genes}
    trt_effect = {g: 0.0 for g in genes}
    for g in CORE_ESSENTIAL:
        ess_effect[g] = float(rng.uniform(-3.6, -1.6))
    for g in mild_fitness:
        ess_effect[g] = float(rng.uniform(-1.0, -0.35))
    for g in RESISTANCE_HITS:
        trt_effect[g] = float(rng.uniform(1.6, 3.0))
    for g in SENSITIZER_HITS:
        trt_effect[g] = float(rng.uniform(-3.0, -1.4))

    # guide table
    rows = []
    for g in genes:
        for k in range(1, GUIDES_PER_GENE + 1):
            rows.append({"sgRNA": f"{g}_sg{k}", "gene": g})
    for k in range(1, N_NTC + 1):
        rows.append({"sgRNA": f"NTC_{k:04d}", "gene": "NON_TARGETING"})
    lib = pd.DataFrame(rows)
    n = len(lib)
    is_ntc = (lib["gene"] == "NON_TARGETING").to_numpy()

    efficacy = rng.beta(5.0, 1.5, size=n)
    dead = rng.random(n) < 0.06
    efficacy[dead] = rng.uniform(0.0, 0.15, size=dead.sum())
    efficacy[is_ntc] = 0.0

    e = lib["gene"].map(ess_effect).fillna(0.0).to_numpy() * efficacy
    t = lib["gene"].map(trt_effect).fillna(0.0).to_numpy() * efficacy
    e = e + rng.normal(0, 0.08, n) * (~is_ntc)  # small off-target / gene noise

    plasmid_p = rng.lognormal(0.0, 0.45, n)
    failed = rng.choice(np.where(~is_ntc)[0], N_FAILED_SYNTHESIS, replace=False)
    plasmid_p[failed] = 0.0
    plasmid_p /= plasmid_p.sum()

    day0_p = plasmid_p * 2 ** rng.normal(0, 0.15, n)
    day0_p /= day0_p.sum()

    props: dict[str, np.ndarray] = {"plasmid": plasmid_p, "day0": day0_p}
    for s in ["treat_rep1", "treat_rep2", "ctrl_rep1", "ctrl_rep2"]:
        lfc = e + (t if s.startswith("treat") else 0.0) + rng.normal(0, BIO_NOISE_SD, n)
        p = day0_p * 2**lfc
        p /= p.sum()
        if s == BOTTLENECK_SAMPLE:
            cells = rng.multinomial(BOTTLENECK_CELLS_PER_GUIDE * n, p)
            p = cells / cells.sum()
        props[s] = p

    counts = lib.copy()
    for s in SAMPLES:
        counts[s] = _gamma_poisson(rng, props[s] * DEPTH[s], NB_ALPHA).astype(int)

    # an imperfect public reference list of common essentials: 85% recall + a few fitness genes
    ref_ess = sorted(
        list(rng.choice(CORE_ESSENTIAL, int(0.85 * len(CORE_ESSENTIAL)), replace=False))
        + list(rng.choice(mild_fitness, 8, replace=False))
    )

    truth = {
        "seed": seed,
        "core_essential": sorted(CORE_ESSENTIAL),
        "resistance_hits": sorted(RESISTANCE_HITS),
        "sensitizer_hits": sorted(SENSITIZER_HITS),
        "mild_fitness": mild_fitness,
        "bad_sample": BOTTLENECK_SAMPLE,
        "bad_sample_issue": "low_coverage_bottleneck",
        "failed_synthesis_guides": sorted(lib.loc[failed, "sgRNA"].tolist()),
        "gene_effects": {
            g: {"essential_lfc": round(ess_effect[g], 3), "treatment_lfc": round(trt_effect[g], 3)}
            for g in genes if ess_effect[g] != 0.0 or trt_effect[g] != 0.0
        },
        "enriched_pathway_resistance": "MISMATCH_REPAIR",
        "depth": DEPTH,
    }
    files = {"pathways": pathways, "reference_essentials": ref_ess}
    return counts, {"truth": truth, **files}


DESIGN_MD = """# Screen design

Pooled CRISPR knockout screen (synthetic data).

- Library: {n_genes} genes x {gpg} sgRNAs + {n_ntc} non-targeting controls (`NON_TARGETING`).
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
"""


def write(seed: int = SEED) -> None:
    counts, extra = generate(seed)
    SCREEN_DIR.mkdir(parents=True, exist_ok=True)
    counts.to_csv(SCREEN_DIR / "counts.tsv", sep="\t", index=False)

    samples = pd.DataFrame([
        {"sample": "plasmid", "condition": "plasmid", "replicate": 1, "timepoint": "library"},
        {"sample": "day0", "condition": "day0", "replicate": 1, "timepoint": "day0"},
        {"sample": "treat_rep1", "condition": "helixin", "replicate": 1, "timepoint": "day14"},
        {"sample": "treat_rep2", "condition": "helixin", "replicate": 2, "timepoint": "day14"},
        {"sample": "ctrl_rep1", "condition": "vehicle", "replicate": 1, "timepoint": "day14"},
        {"sample": "ctrl_rep2", "condition": "vehicle", "replicate": 2, "timepoint": "day14"},
    ])
    samples.to_csv(SCREEN_DIR / "samples.tsv", sep="\t", index=False)

    with open(SCREEN_DIR / "pathways.gmt", "w", newline="\n") as f:
        for name, genes in extra["pathways"].items():
            f.write("\t".join([name, "curated"] + genes) + "\n")
    (SCREEN_DIR / "common_essentials.txt").write_text("\n".join(extra["reference_essentials"]) + "\n")
    (SCREEN_DIR / "design.md").write_text(
        DESIGN_MD.format(n_genes=N_GENES, gpg=GUIDES_PER_GENE, n_ntc=N_NTC)
    )
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "truth.json").write_text(json.dumps(extra["truth"], indent=1))
    print(f"wrote {len(counts)} sgRNAs x {len(SAMPLES)} samples to {SCREEN_DIR}")


if __name__ == "__main__":
    write()
