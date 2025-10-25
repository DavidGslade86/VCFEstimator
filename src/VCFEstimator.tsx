import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

// ---------------------------------------------
// VCF Claim Value Estimator – MVP (stable build)
// ---------------------------------------------
// NOTE: Training tool only – validate against current VCF policies & tables.

// ────────────────────────────────────────────────────────────────────────────────
// Data & helpers
// ────────────────────────────────────────────────────────────────────────────────

/**
 * IMPORTANT (per firm requirements):
 * - All lookup tables (tax, growth, consumption, discount) are treated as
 *   THRESHOLD / BRACKET rates. We pick the bracket for the current value and
 *   use that bracket's rate until the next threshold is reached. NO interpolation
 *   between brackets.
 * - The constants below are authoritative defaults.
 */

// Default NY effective tax rates (demo). Users can override.
const NY_EFFECTIVE_TAX_TABLE = [
  { income: 10000, rate: 0.1482 },
  { income: 20000, rate: 0.1481 },
  { income: 25000, rate: 0.1479 },
  { income: 30000, rate: 0.1386 },
  { income: 35000, rate: 0.1293 },
  { income: 40000, rate: 0.1345 },
  { income: 45000, rate: 0.1396 },
  { income: 50000, rate: 0.1474 },
  { income: 60000, rate: 0.1551 },
  { income: 70000, rate: 0.1629 },
  { income: 80000, rate: 0.1706 },
  { income: 90000, rate: 0.1864 },
  { income: 100000, rate: 0.2021 },
  { income: 125000, rate: 0.2180 },
  { income: 150000, rate: 0.2338 },
  { income: 175000, rate: 0.2497 },
  { income: 200000, rate: 0.2655 },
  { income: 225000, rate: 0.3017 },
  { income: 350000, rate: 0.3378 },
];

/**
 * Bracket (threshold) lookup for TAX (no interpolation).
 */
function interpolateTaxRate(income: number, table = NY_EFFECTIVE_TAX_TABLE) {
  if (!Array.isArray(table) || table.length === 0) return 0;
  let rate = table[0].rate;
  for (let i = 0; i < table.length; i++) {
    if (income >= table[i].income) rate = table[i].rate; else break;
  }
  return rate;
}

// Personal consumption table (percent of income) keyed by pre-disability income
// Columns: Single0 (A), Single1Plus (B), Married0 (C), Married1 (D), Married2Plus (E)
const CONSUMPTION_TABLE = [
  { income: 10000, Single0: 0.779, Single1Plus: 0.185, Married0: 0.370, Married1: 0.194, Married2Plus: 0.131 },
  { income: 20000, Single0: 0.763, Single1Plus: 0.182, Married0: 0.344, Married1: 0.184, Married2Plus: 0.126 },
  { income: 25000, Single0: 0.755, Single1Plus: 0.180, Married0: 0.330, Married1: 0.180, Married2Plus: 0.123 },
  { income: 30000, Single0: 0.747, Single1Plus: 0.178, Married0: 0.317, Married1: 0.175, Married2Plus: 0.121 },
  { income: 35000, Single0: 0.753, Single1Plus: 0.185, Married0: 0.290, Married1: 0.169, Married2Plus: 0.120 },
  { income: 40000, Single0: 0.751, Single1Plus: 0.185, Married0: 0.258, Married1: 0.157, Married2Plus: 0.113 },
  { income: 45000, Single0: 0.748, Single1Plus: 0.185, Married0: 0.226, Married1: 0.145, Married2Plus: 0.107 },
  { income: 50000, Single0: 0.732, Single1Plus: 0.184, Married0: 0.219, Married1: 0.142, Married2Plus: 0.105 },
  { income: 60000, Single0: 0.715, Single1Plus: 0.182, Married0: 0.211, Married1: 0.138, Married2Plus: 0.103 },
  { income: 70000, Single0: 0.682, Single1Plus: 0.175, Married0: 0.189, Married1: 0.126, Married2Plus: 0.094 },
  { income: 80000, Single0: 0.641, Single1Plus: 0.165, Married0: 0.172, Married1: 0.116, Married2Plus: 0.087 },
  { income: 90000, Single0: 0.620, Single1Plus: 0.160, Married0: 0.164, Married1: 0.110, Married2Plus: 0.083 },
  { income: 100000, Single0: 0.599, Single1Plus: 0.155, Married0: 0.155, Married1: 0.105, Married2Plus: 0.080 },
  { income: 125000, Single0: 0.548, Single1Plus: 0.143, Married0: 0.143, Married1: 0.097, Married2Plus: 0.073 },
  { income: 150000, Single0: 0.519, Single1Plus: 0.137, Married0: 0.132, Married1: 0.090, Married2Plus: 0.069 },
  { income: 175000, Single0: 0.490, Single1Plus: 0.131, Married0: 0.120, Married1: 0.084, Married2Plus: 0.084 },
  { income: 200000, Single0: 0.337, Single1Plus: 0.096, Married0: 0.100, Married1: 0.070, Married2Plus: 0.054 },
  { income: 225000, Single0: 0.184, Single1Plus: 0.060, Married0: 0.081, Married1: 0.056, Married2Plus: 0.043 },
];

/**
 * Bracket (threshold) lookup for CONSUMPTION (no interpolation).
 */
function interpolateConsumption(preIncome: number, marital: "single"|"married", childrenUnder23: number, table = CONSUMPTION_TABLE) {
  const col = (() => {
    if (marital === "single") return childrenUnder23 >= 1 ? "Single1Plus" : "Single0";
    if (childrenUnder23 >= 2) return "Married2Plus";
    if (childrenUnder23 === 1) return "Married1";
    return "Married0";
  })();
  if (!Array.isArray(table) || table.length === 0) return 0;
  let row = table[0];
  for (let i = 0; i < table.length; i++) {
    if (preIncome >= (table[i] as any).income) row = table[i] as any; else break;
  }
  return (row as any)[col] as number;
}

// Helper: count children under 23 in year t (0-indexed)
function getChildCountUnder23(ages: (number | "none")[], yearIndex: number): number {
  const count = ages.reduce((acc: number, age) => {
    if (typeof age === "number" && age + yearIndex < 23) return acc + 1;
    return acc;
  }, 0);
  return Math.min(count, 2);
}

// Age-specific nominal earnings growth (Table 3 excerpt; fallback 3% for 52+)
const AGE_GROWTH: Record<number, number> = {
  18: 0.09523, 19: 0.09364, 20: 0.09209, 21: 0.09057, 22: 0.08856, 23: 0.08655,
  24: 0.08454, 25: 0.08253, 26: 0.08053, 27: 0.07853, 28: 0.07654, 29: 0.07455,
  30: 0.07256, 31: 0.07058, 32: 0.0686, 33: 0.06663, 34: 0.06465, 35: 0.06269,
  36: 0.06072, 37: 0.05876, 38: 0.0568, 39: 0.05484, 40: 0.0529, 41: 0.05095,
  42: 0.04901, 43: 0.04707, 44: 0.04514, 45: 0.04321, 46: 0.04128, 47: 0.03935,
  48: 0.03743, 49: 0.03551, 50: 0.0336, 51: 0.03169,
};

function ageGrowth(age: number, fallback = 0.03) {
  return AGE_GROWTH[age] ?? (age >= 52 ? fallback : 0.03);
}

function discountRateAfterTaxForAge(age: number) {
  if (age <= 35) return 0.026; // Table 5 (≤35)
  if (age <= 54) return 0.024; // 36–54
  return 0.021; // 55+
}

function currency(n: number) {
  if (!isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function pct(n: number) {
  if (!isFinite(n)) return "—";
  return (n * 100).toFixed(2) + "%";
}

// ────────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────────

type Mode = "injury" | "wrongfulDeath";
type Marital = "single" | "married";
type MedicalGrowthMode = "cpi" | "cpi_medical" | "custom";

export default function VCFEstimator() {
  const [mode, setMode] = useState<Mode>("wrongfulDeath");
  const [ageAtStart, setAgeAtStart] = useState(55);
  const [years, setYears] = useState(12);
  const [baseIncome, setBaseIncome] = useState(100000);
  const [taxRate, setTaxRate] = useState<number | "auto">("auto");

  // Household & consumption dynamics
  const [marital, setMarital] = useState<Marital>("married");
  const [child1Age, setChild1Age] = useState<number | "none">("none");
  const [child2Age, setChild2Age] = useState<number | "none">("none");
  const [manualConsumption, setManualConsumption] = useState<boolean>(false);
  const [consumptionPct, setConsumptionPct] = useState(0.105); // example: married+1 @ $100k

  const [useAgeSpecificGrowth, setUseAgeSpecificGrowth] = useState(true);
  const [earningsGrowthFixed, setEarningsGrowthFixed] = useState(0.03);
  const [retirementPct, setRetirementPct] = useState(0.04);

  // Medical benefit settings
  const [medicalBase, setMedicalBase] = useState(7280); // firm's baseline
  const [medicalGrowth, setMedicalGrowth] = useState(0.023); // default CPI + medical (3.04%)
  const [medicalGrowthMode, setMedicalGrowthMode] = useState<MedicalGrowthMode>("cpi");

  const [unemploymentFactor, setUnemploymentFactor] = useState(0.06);
  const [discountOverride, setDiscountOverride] = useState<number | "auto">("auto");
  const [unemploymentTiming, setUnemploymentTiming] = useState<"before_medical"|"after_medical">("before_medical");

  // Offsets (simple MVP): periodic annual amount (after-tax equivalent) for N years, and lump sum
  const [offsetAnnual, setOffsetAnnual] = useState(0);
  const [offsetYears, setOffsetYears] = useState(0);
  const [offsetLumpSum, setOffsetLumpSum] = useState(0);

  // Reference tables navigation
  const [activeRefTable, setActiveRefTable] = useState<"tax"|"worklife"|"growth"|"consumption"|"discount">("tax");

  // Keep medical growth in sync with mode unless custom
  const onMedicalGrowthModeChange = (v: MedicalGrowthMode) => {
    setMedicalGrowthMode(v);
    if (v === "cpi") setMedicalGrowth(0.023);
    else if (v === "cpi_medical") setMedicalGrowth(0.0304);
    // custom leaves current value unchanged
  };

  // Firm Work-Life Expectancy (simplified) — round to nearest year
  const WORKLIFE_TABLE: { age: number; years: number; exit: number }[] = [
    { age: 25, years: 34.87, exit: 60 },
    { age: 26, years: 34.04, exit: 60 },
    { age: 27, years: 33.20, exit: 60 },
    { age: 28, years: 32.36, exit: 60 },
    { age: 29, years: 31.51, exit: 61 },
    { age: 30, years: 30.66, exit: 61 },
    { age: 31, years: 29.81, exit: 61 },
    { age: 32, years: 28.94, exit: 61 },
    { age: 33, years: 28.08, exit: 61 },
    { age: 34, years: 27.23, exit: 61 },
    { age: 35, years: 26.37, exit: 61 },
    { age: 36, years: 25.52, exit: 62 },
    { age: 37, years: 24.67, exit: 62 },
    { age: 38, years: 23.83, exit: 62 },
    { age: 39, years: 22.98, exit: 62 },
    { age: 40, years: 22.14, exit: 62 },
    { age: 41, years: 21.30, exit: 62 },
    { age: 42, years: 20.46, exit: 62 },
    { age: 43, years: 19.64, exit: 63 },
    { age: 44, years: 18.82, exit: 63 },
    { age: 45, years: 18.01, exit: 63 },
    { age: 46, years: 17.22, exit: 63 },
    { age: 47, years: 16.42, exit: 63 },
    { age: 48, years: 15.64, exit: 64 },
    { age: 49, years: 14.87, exit: 64 },
    { age: 50, years: 14.13, exit: 64 },
    { age: 51, years: 13.39, exit: 64 },
    { age: 52, years: 12.66, exit: 65 },
    { age: 53, years: 11.93, exit: 65 },
    { age: 54, years: 11.22, exit: 65 },
    { age: 55, years: 10.53, exit: 66 },
    { age: 56, years: 9.87, exit: 66 },
    { age: 57, years: 9.21, exit: 66 },
    { age: 58, years: 8.58, exit: 67 },
    { age: 59, years: 7.95, exit: 67 },
    { age: 60, years: 7.36, exit: 67 },
    { age: 61, years: 6.81, exit: 68 },
    { age: 62, years: 6.33, exit: 68 },
    { age: 63, years: 5.90, exit: 69 },
    { age: 64, years: 5.51, exit: 70 },
    { age: 65, years: 5.17, exit: 70 },
    { age: 66, years: 4.89, exit: 71 },
    { age: 67, years: 4.65, exit: 72 },
    { age: 68, years: 4.43, exit: 72 },
    { age: 69, years: 4.21, exit: 73 },
    { age: 70, years: 4.01, exit: 74 },
  ];
  function lookupWorklife(age: number) {
    const minAge = WORKLIFE_TABLE[0].age;
    const maxAge = WORKLIFE_TABLE[WORKLIFE_TABLE.length - 1].age;
    const a = Math.max(minAge, Math.min(maxAge, Math.round(age)));
    const entry = WORKLIFE_TABLE.find(r => r.age === a)!;
    const roundedYears = Math.round(entry.years);
    const exitAge = Math.round(age + roundedYears);
    return { years: roundedYears, exitAge };
  }

  // Auto work-life (rounded) from firm table
  const autoWL = useMemo(() => lookupWorklife(ageAtStart), [ageAtStart]);
  const [useFirmWorklife, setUseFirmWorklife] = useState(true);
  const calcYears = useFirmWorklife ? autoWL.years : years;
  const expectedExitAge = useFirmWorklife ? autoWL.exitAge : (ageAtStart + years);

  // Core computation
  const results = useMemo(() => {
    const effTax = taxRate === "auto" ? interpolateTaxRate(baseIncome) : (taxRate ?? 0);
    const disc = discountOverride === "auto" ? discountRateAfterTaxForAge(ageAtStart) : (discountOverride ?? 0.025);

    // Consumption dollars are anchored to after-tax income at death/disability
    const afterTaxAtStart = baseIncome * (1 - effTax);

    let salary = baseIncome;
    let med = medicalBase;
    let pvSum = 0;
    const rows: any[] = [];

    for (let t = 1; t <= calcYears; t++) {
      const age = ageAtStart + t; // Year 1 is the first full year AFTER disability/death
      const earnGrowth = useAgeSpecificGrowth ? ageGrowth(age) : earningsGrowthFixed;

      // Grow salary at the start of each year (including t=1)
      salary = salary * (1 + earnGrowth);
      // Apply medical growth starting in Year 1 so year 1 = base * (1 + medicalGrowth)
      med = med * (1 + medicalGrowth);

      const retirement = salary * retirementPct;
      const incomePlusRet = salary + retirement; // base for adjustments

      // Dynamic consumption (wrongful death only)
      let yearConsumption = 0;
      if (mode === "wrongfulDeath") {
        const y = t - 1;
        const childUnder23Count = getChildCountUnder23([child1Age, child2Age], y);
        yearConsumption = manualConsumption ? consumptionPct : interpolateConsumption(baseIncome, marital, childUnder23Count);
      }

      // Apply unemployment per timing
      let unemploymentAdjIncome = 0; // value shown in table
      let postTaxBase = 0;
      let consumptionAmt = 0;
      let afterConsumption = 0;
      let subtotalBeforeDiscount = 0;

      if (unemploymentTiming === "before_medical") {
        // 1) Income+Ret → 2) 6% unemployment → 3) tax → 4) consumption → 5) +medical
        unemploymentAdjIncome = incomePlusRet * (1 - unemploymentFactor);
        postTaxBase = unemploymentAdjIncome * (1 - effTax);
        consumptionAmt = mode === "wrongfulDeath" ? afterTaxAtStart * yearConsumption : 0;
        afterConsumption = postTaxBase - consumptionAmt;
        subtotalBeforeDiscount = afterConsumption + med;
      } else {
        // Legacy: tax/consume on income+ret, then add medical, then 6% unemployment.
        postTaxBase = incomePlusRet * (1 - effTax);
        consumptionAmt = mode === "wrongfulDeath" ? afterTaxAtStart * yearConsumption : 0;
        afterConsumption = postTaxBase - consumptionAmt;
        const subtotal = afterConsumption + med;
        unemploymentAdjIncome = subtotal * (1 - unemploymentFactor);
        subtotalBeforeDiscount = unemploymentAdjIncome;
      }

      const pv = subtotalBeforeDiscount / Math.pow(1 + disc, t);
      pvSum += pv;

      rows.push({
        year: t,
        age,
        earnGrowth,
        projectedIncome: salary,
        retirement,
        incomePlusRet,
        taxRate: effTax,
        postTaxProjectedIncome: postTaxBase,
        consumptionRate: yearConsumption,
        consumptionAmt,
        incomeLessConsumption: afterConsumption,
        healthContribution: med,
        unemploymentAdjIncome, // fixed: previously referenced undefined variable
        postTaxAdjusted: subtotalBeforeDiscount,
        discounted: pv,
      });
    }

    // Offsets PV
    let pvOffset = 0;
    if (offsetAnnual > 0 && offsetYears > 0) {
      for (let t = 1; t <= offsetYears; t++) {
        pvOffset += offsetAnnual / Math.pow(1 + disc, t);
      }
    }
    pvOffset += offsetLumpSum;

    const netPV = Math.max(0, pvSum - pvOffset);
    return { pvSum, pvOffset, netPV, effTax, disc, rows };
  }, [
    mode,
    marital,
    child1Age,
    child2Age,
    ageAtStart,
    calcYears,
    baseIncome,
    taxRate,
    manualConsumption,
    consumptionPct,
    useAgeSpecificGrowth,
    earningsGrowthFixed,
    retirementPct,
    medicalBase,
    medicalGrowth,
    unemploymentFactor,
    discountOverride,
    offsetAnnual,
    offsetYears,
    offsetLumpSum,
    unemploymentTiming,
  ]);

  // ────────────────────────────────────────────────────────────────────────────
  // Lightweight dev tests (run-time assertions). These do NOT affect prod.
  // ────────────────────────────────────────────────────────────────────────────
  function runDevTests() {
    try {
      // Test: child countdown to age 23
      console.assert(getChildCountUnder23([18, "none"], 0) === 1, "child count t0");
      console.assert(getChildCountUnder23([18, "none"], 5) === 1, "child count t5");
      console.assert(getChildCountUnder23([18, "none"], 6) === 0, "child aged out t6 (24)");
      console.assert(getChildCountUnder23([18, 10], 5) === 1, "one child aged out; other under");

      // Test: consumption table lookup exact hit
      console.assert(Math.abs(interpolateConsumption(100000, "married", 2) - 0.08) < 1e-9, "consumption married 2 @100k");

      // Test: tax monotonicity sample brackets
      const t90 = interpolateTaxRate(90000);
      const t100 = interpolateTaxRate(100000);
      console.assert(t100 >= t90, "tax non-decreasing 90k->100k");

      // Test: results rows length matches years
      console.assert(results.rows.length === calcYears, "rows length === calcYears");

      // Test: before_medical ordering (sanity)
      const tmpTax = interpolateTaxRate(100000);
      const incomePlusRet = 100000 * (1 + 0.04);
      const unemploymentAdj = incomePlusRet * (1 - 0.06);
      const postTax = unemploymentAdj * (1 - tmpTax);
      console.assert(unemploymentAdj < incomePlusRet && postTax < unemploymentAdj, "ordering check before_medical");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Dev tests threw:", e);
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
      runDevTests();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcYears, baseIncome, mode, marital, child1Age, child2Age]);

  // ────────────────────────────────────────────────────────────────────────────────
  // UI
  // ────────────────────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">VCF Claim Value Estimator – MVP</h1>
        <div className="flex items-center gap-4">
          <Label className="text-sm">Mode</Label>
          <Select value={mode} onValueChange={(v: any) => setMode(v as Mode)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="injury">Injury (no consumption)</SelectItem>
              <SelectItem value="wrongfulDeath">Wrongful Death (consumption)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
          <div>
            <Label>Age at Start of Loss</Label>
            <Input type="number" value={ageAtStart} onChange={(e)=>setAgeAtStart(parseInt(e.target.value||"0"))} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label>Work-Life (Years)</Label>
              <div className="flex items-center gap-2">
                <Switch checked={useFirmWorklife} onCheckedChange={setUseFirmWorklife} />
                <span className="text-xs text-muted-foreground">Use firm table</span>
              </div>
            </div>
            <Input type="number" value={useFirmWorklife ? calcYears : years} disabled={useFirmWorklife}
              onChange={(e)=>setYears(parseInt(e.target.value||"0"))} />
            <p className="text-xs text-muted-foreground">Expected exit age ≈ {useFirmWorklife ? expectedExitAge : (ageAtStart + years)}</p>
          </div>
          <div>
            <Label>Base Income ($)</Label>
            <Input type="number" value={baseIncome} onChange={(e)=>setBaseIncome(parseFloat(e.target.value||"0"))} />
          </div>

          <div>
            <Label>Effective Tax Rate</Label>
            <div className="flex items-center gap-2">
              <Switch checked={taxRate!=="auto"} onCheckedChange={(v)=>setTaxRate(v ? interpolateTaxRate(baseIncome) : "auto")} />
              <span className="text-sm text-muted-foreground">Manual</span>
            </div>
            <Input type="number" step="0.0001" value={taxRate==="auto"? interpolateTaxRate(baseIncome) : (taxRate as number)} onChange={(e)=>setTaxRate(parseFloat(e.target.value||"0"))} />
            <p className="text-xs text-muted-foreground">Auto uses bracket lookup</p>
          </div>

          <div>
            <Label>Household (for WD)</Label>
            <div className="flex items-center gap-3">
              <Select value={marital} onValueChange={(v: any)=>setMarital(v as Marital)}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Marital" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single</SelectItem>
                  <SelectItem value="married">Married</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div>
                <Label>Child #1 Age (or none)</Label>
                <Input type="number" placeholder="none" value={child1Age === "none" ? "" : (child1Age as number)}
                  onChange={(e)=>{
                    const v = e.target.value === "" ? "none" : parseInt(e.target.value||"0");
                    setChild1Age(v as any);
                  }} />
              </div>
              <div>
                <Label>Child #2 Age (or none)</Label>
                <Input type="number" placeholder="none" value={child2Age === "none" ? "" : (child2Age as number)}
                  onChange={(e)=>{
                    const v = e.target.value === "" ? "none" : parseInt(e.target.value||"0");
                    setChild2Age(v as any);
                  }} />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Switch checked={manualConsumption} onCheckedChange={setManualConsumption} />
              <span className="text-sm">Manual consumption override</span>
            </div>
            {manualConsumption && (
              <>
                <Label>Consumption %</Label>
                <Input type="number" step="0.0001" value={consumptionPct} onChange={(e)=>setConsumptionPct(parseFloat(e.target.value||"0"))} />
              </>
            )}
          </div>

          <div>
            <Label>Earnings Growth</Label>
            <div className="flex items-center gap-3 py-2">
              <Switch checked={useAgeSpecificGrowth} onCheckedChange={setUseAgeSpecificGrowth} />
              <span className="text-sm">Use age-specific (Table 3 excerpt; 52+ = 3%)</span>
            </div>
            {!useAgeSpecificGrowth && (
              <>
                <Label>Fixed Growth Rate</Label>
                <Input type="number" step="0.0001" value={earningsGrowthFixed} onChange={(e)=>setEarningsGrowthFixed(parseFloat(e.target.value||"0"))} />
              </>
            )}
          </div>

          <div>
            <Label>Retirement % of Salary</Label>
            <Input type="number" step="0.0001" value={retirementPct} onChange={(e)=>setRetirementPct(parseFloat(e.target.value||"0"))} />
          </div>

          <div>
            <Label>Medical Benefit (Year 1)</Label>
            <Input type="number" value={medicalBase} onChange={(e)=>setMedicalBase(parseFloat(e.target.value||"0"))} />
            <Label className="mt-2 block">Medical Growth</Label>
            <Select value={medicalGrowthMode} onValueChange={(v: any)=>onMedicalGrowthModeChange(v as MedicalGrowthMode)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Growth Mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cpi">CPI Only (2.3%)</SelectItem>
                <SelectItem value="cpi_medical">CPI + Medical (3.04%)</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            {medicalGrowthMode === "custom" && (
              <Input type="number" step="0.0001" value={medicalGrowth} onChange={(e)=>setMedicalGrowth(parseFloat(e.target.value||"0"))} className="mt-2" />
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Default 2.3% (CPI only). The CPI+medical (3.04%) option is available.
            </p>
          </div>

          <div>
            <Label>Unemployment Factor</Label>
            <Input type="number" step="0.0001" value={unemploymentFactor} onChange={(e)=>setUnemploymentFactor(parseFloat(e.target.value||"0"))} />
            <p className="text-xs text-muted-foreground">Default 0.06 (6%)</p>
            <Label className="mt-3 block">Unemployment Timing</Label>
            <Select value={unemploymentTiming} onValueChange={(v:any)=>setUnemploymentTiming(v as any)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Timing" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="before_medical">Apply after retirement, before medical</SelectItem>
                <SelectItem value="after_medical">Apply after medical (legacy)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>After-Tax Discount Rate</Label>
            <div className="flex items-center gap-2">
              <Switch checked={discountOverride!=="auto"} onCheckedChange={(v)=>setDiscountOverride(v ? discountRateAfterTaxForAge(ageAtStart) : "auto")} />
              <span className="text-sm text-muted-foreground">Manual</span>
            </div>
            <Input type="number" step="0.0001" value={discountOverride==="auto" ? discountRateAfterTaxForAge(ageAtStart) : (discountOverride as number)} onChange={(e)=>setDiscountOverride(parseFloat(e.target.value||"0"))} />
            <p className="text-xs text-muted-foreground">Auto picks 2.6% (≤35), 2.4% (36–54), 2.1% (55+)</p>
          </div>

          <div className="md:col-span-3 border-t pt-4">
            <h3 className="font-medium mb-2">Offsets (simple)</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Annual Offset Amount ($)</Label>
                <Input type="number" value={offsetAnnual} onChange={(e)=>setOffsetAnnual(parseFloat(e.target.value||"0"))} />
              </div>
              <div>
                <Label>Offset Years</Label>
                <Input type="number" value={offsetYears} onChange={(e)=>setOffsetYears(parseInt(e.target.value||"0"))} />
              </div>
              <div>
                <Label>Lump-Sum Offset (PV) ($)</Label>
                <Input type="number" value={offsetLumpSum} onChange={(e)=>setOffsetLumpSum(parseFloat(e.target.value||"0"))} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-6 space-y-2">
          <h3 className="font-medium">Results</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 text-sm">
            <div className="p-3 rounded-xl bg-muted/30">
              <div className="text-muted-foreground">Effective Tax</div>
              <div className="text-lg font-semibold">{(results.effTax*100).toFixed(2)}%</div>
            </div>
            <div className="p-3 rounded-xl bg-muted/30">
              <div className="text-muted-foreground">Discount Rate</div>
              <div className="text-lg font-semibold">{(results.disc*100).toFixed(2)}%</div>
            </div>
            <div className="p-3 rounded-xl bg-muted/30">
              <div className="text-muted-foreground">Gross PV (pre-offset)</div>
              <div className="text-lg font-semibold">{currency(results.pvSum)}</div>
            </div>
            <div className="p-3 rounded-xl bg-muted/30">
              <div className="text-muted-foreground">Offsets PV</div>
              <div className="text-lg font-semibold">{currency(results.pvOffset)}</div>
            </div>
            <div className="p-3 rounded-xl bg-muted/30">
              <div className="text-muted-foreground">Expected Exit Age</div>
              <div className="text-lg font-semibold">{expectedExitAge}</div>
            </div>
          </div>
          <div className="p-4 rounded-2xl border mt-4">
            <div className="text-muted-foreground text-sm">Estimated Award (Economic Loss Component)</div>
            <div className="text-2xl font-bold">{currency(results.netPV)}</div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Training tool only. Verify tax domicile, work-life from Skoog/Ciecka/Krueger, and apply the VCF cap & detailed offset rules as appropriate.</p>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-6 space-y-4">
          <h3 className="font-medium">Year-by-Year Breakdown</h3>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-2 pr-3">Year</th>
                  <th className="py-2 pr-3">Age</th>
                  <th className="py-2 pr-3">Income Growth %</th>
                  <th className="py-2 pr-3">Projected Income</th>
                  <th className="py-2 pr-3">+ Retirement (4%)</th>
                  <th className="py-2 pr-3">Income + Retirement</th>
                  {unemploymentTiming === 'before_medical' && (
                    <th className="py-2 pr-3">− 6% Unemployment</th>
                  )}
                  <th className="py-2 pr-3">Tax Rate</th>
                  <th className="py-2 pr-3">Post-tax Income</th>
                  <th className="py-2 pr-3">Consumption %</th>
                  <th className="py-2 pr-3">Consumption $</th>
                  <th className="py-2 pr-3">Income − Consumption</th>
                  <th className="py-2 pr-3">Health Contribution</th>
                  <th className="py-2 pr-3">Subtotal (post-tax adj.)</th>
                  {unemploymentTiming === 'after_medical' && (
                    <th className="py-2 pr-3">− 6% Unemployment</th>
                  )}
                  <th className="py-2 pr-3">Discounted PV</th>
                </tr>
              </thead>
              <tbody>
                {results.rows.map((r: any) => (
                  <tr key={r.year} className="border-t">
                    <td className="py-2 pr-3">{r.year}</td>
                    <td className="py-2 pr-3">{r.age}</td>
                    <td className="py-2 pr-3">{pct(r.earnGrowth)}</td>
                    <td className="py-2 pr-3">{currency(r.projectedIncome)}</td>
                    <td className="py-2 pr-3">{currency(r.retirement)}</td>
                    <td className="py-2 pr-3">{currency(r.incomePlusRet)}</td>
                    {unemploymentTiming === 'before_medical' && (
                      <td className="py-2 pr-3">{currency(r.unemploymentAdjIncome)}</td>
                    )}
                    <td className="py-2 pr-3">{pct(r.taxRate)}</td>
                    <td className="py-2 pr-3">{currency(r.postTaxProjectedIncome)}</td>
                    <td className="py-2 pr-3">{mode === 'wrongfulDeath' ? pct(r.consumptionRate) : '—'}</td>
                    <td className="py-2 pr-3">{mode === 'wrongfulDeath' ? currency(r.consumptionAmt) : '—'}</td>
                    <td className="py-2 pr-3">{currency(r.incomeLessConsumption)}</td>
                    <td className="py-2 pr-3">{currency(r.healthContribution)}</td>
                    <td className="py-2 pr-3">{currency(r.postTaxAdjusted)}</td>
                    {unemploymentTiming === 'after_medical' && (
                      <td className="py-2 pr-3">{currency(r.unemploymentAdjIncome)}</td>
                    )}
                    <td className="py-2 pr-3">{currency(r.discounted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Note: The unemployment toggle lets you compare applying the 6% factor before adding medical (medical unaffected) versus after adding medical (legacy approach). Retirement is always included with income for tax & consumption.</p>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h3 className="font-medium">Reference Tables (for transparency)</h3>
            <div className="flex items-center gap-2">
              <Button variant={activeRefTable === 'tax' ? 'default' : 'outline'} size="sm" onClick={()=>setActiveRefTable('tax')}>Table 1: Tax</Button>
              <Button variant={activeRefTable === 'worklife' ? 'default' : 'outline'} size="sm" onClick={()=>setActiveRefTable('worklife')}>Table 2: Work-Life</Button>
              <Button variant={activeRefTable === 'growth' ? 'default' : 'outline'} size="sm" onClick={()=>setActiveRefTable('growth')}>Table 3: Earnings Growth</Button>
              <Button variant={activeRefTable === 'consumption' ? 'default' : 'outline'} size="sm" onClick={()=>setActiveRefTable('consumption')}>Table 4: Consumption</Button>
              <Button variant={activeRefTable === 'discount' ? 'default' : 'outline'} size="sm" onClick={()=>setActiveRefTable('discount')}>Table 5: Discount</Button>
            </div>
          </div>

          {activeRefTable === 'tax' && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Table 1 — Effective Tax Rate (bracket, no interpolation)</h4>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="py-2 pr-3">Income Threshold</th>
                      <th className="py-2 pr-3">Effective Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {NY_EFFECTIVE_TAX_TABLE.map((r, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="py-2 pr-3">{r.income.toLocaleString()}</td>
                        <td className="py-2 pr-3">{(r.rate * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeRefTable === 'worklife' && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Table 2 — Expected Years of Workforce Participation (firm table)</h4>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="py-2 pr-3">Age</th>
                      <th className="py-2 pr-3">Remaining Years</th>
                      <th className="py-2 pr-3">Expected Exit Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {WORKLIFE_TABLE.map((r) => (
                      <tr key={r.age} className="border-t">
                        <td className="py-2 pr-3">{r.age}</td>
                        <td className="py-2 pr-3">{r.years.toFixed(2)}</td>
                        <td className="py-2 pr-3">{r.exit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeRefTable === 'growth' && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Table 3 — Age-Specific Earnings Growth (Job growth, inflation, productivity)</h4>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="py-2 pr-3">Age</th>
                      <th className="py-2 pr-3">Nominal Growth %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(AGE_GROWTH).sort((a,b)=>Number(a[0]) - Number(b[0])).map(([age, rate]) => (
                      <tr key={age} className="border-t">
                        <td className="py-2 pr-3">{age}</td>
                        <td className="py-2 pr-3">{(Number(rate) * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                    <tr className="border-t">
                      <td className="py-2 pr-3">52+</td>
                      <td className="py-2 pr-3">3.00% (fallback)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeRefTable === 'consumption' && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Table 4 — Decedent's Personal Consumption as % of Income (by household)</h4>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="py-2 pr-3">Income Threshold</th>
                      <th className="py-2 pr-3">Single, 0 children</th>
                      <th className="py-2 pr-3">Single, ≥1 child</th>
                      <th className="py-2 pr-3">Married, 0 children</th>
                      <th className="py-2 pr-3">Married, 1 child</th>
                      <th className="py-2 pr-3">Married, ≥2 children</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CONSUMPTION_TABLE.map((r, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="py-2 pr-3">{r.income.toLocaleString()}</td>
                        <td className="py-2 pr-3">{(r.Single0 * 100).toFixed(1)}%</td>
                        <td className="py-2 pr-3">{(r.Single1Plus * 100).toFixed(1)}%</td>
                        <td className="py-2 pr-3">{(r.Married0 * 100).toFixed(1)}%</td>
                        <td className="py-2 pr-3">{(r.Married1 * 100).toFixed(1)}%</td>
                        <td className="py-2 pr-3">{(r.Married2Plus * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeRefTable === 'discount' && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Table 5 — Assumed After-Tax Discount Rate for Present Value</h4>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="py-2 pr-3">Age at Start</th>
                      <th className="py-2 pr-3">After-Tax Discount Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="py-2 pr-3">≤ 35</td>
                      <td className="py-2 pr-3">2.60%</td>
                    </tr>
                    <tr className="border-t">
                      <td className="py-2 pr-3">36–54</td>
                      <td className="py-2 pr-3">2.40%</td>
                    </tr>
                    <tr className="border-t">
                      <td className="py-2 pr-3">55+</td>
                      <td className="py-2 pr-3">2.10%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="text-xs text-muted-foreground">These tables reflect the hard-coded demo defaults used by this MVP. Always validate against current firm policies and data sources.</p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Back to Top</Button>
      </div>
    </div>
  );
}
