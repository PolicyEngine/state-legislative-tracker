// State data focused on 2026 legislative session
// Tax changes, active bills, and research coverage

export const stateData = {
  AL: {
    name: "Alabama",
    abbr: "AL",
    session: { status: "active", dates: "Jan 13 - Mar 27, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "5%", brackets: 3 },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  AK: {
    name: "Alaska",
    abbr: "AK",
    session: { status: "active", dates: "Jan 20 - May 20, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: false, note: "No state income tax" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  AZ: {
    name: "Arizona",
    abbr: "AZ",
    session: { status: "active", dates: "Jan 12 - Apr 25, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "2.5%" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  AR: {
    name: "Arkansas",
    abbr: "AR",
    session: { status: "active", dates: "Apr 8 - May 7, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "4.4%", brackets: 3 },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  CA: {
    name: "California",
    abbr: "CA",
    session: { status: "active", dates: "Jan 5 - Aug 31, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "13.3%", brackets: 9 },
      stateEITC: { available: true, name: "CalEITC", type: "custom" },
      stateCTC: { available: true, name: "Young Child Tax Credit" },
    },
    legislativeActivity: "high",
    activeBills: [
      { bill: "ACA 3 (Billionaire Tax)", status: "Proposed", description: "5% wealth tax on $1B+", url: "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260ACA3" }
    ],
    taxChanges: [],
  },
  CO: {
    name: "Colorado",
    abbr: "CO",
    session: { status: "active", dates: "Jan 14 - May 13, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "4.4%" },
      stateEITC: { available: true, name: "Colorado EITC", match: "25%" },
      stateCTC: { available: true, name: "Colorado CTC" },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  CT: {
    name: "Connecticut",
    abbr: "CT",
    session: { status: "active", dates: "Feb 4 - May 6, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "6.99%", brackets: 7 },
      stateEITC: { available: true, match: "30.5%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  DE: {
    name: "Delaware",
    abbr: "DE",
    session: { status: "active", dates: "Jan 13 - Jun 30, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "6.6%", brackets: 7 },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  FL: {
    name: "Florida",
    abbr: "FL",
    session: { status: "active", dates: "Jan 13 - Mar 13, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: false, note: "No state income tax" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  GA: {
    name: "Georgia",
    abbr: "GA",
    session: { status: "active", dates: "Jan 12 - Apr 6, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "5.09%" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "high",
    activeBills: [
      {
        bill: "HB111",
        status: "Proposed",
        description: "Reduces flat income tax rate from 5.09% to 4.99% (accelerates scheduled 2027 cut)",
        url: "https://www.legis.ga.gov/legislation/72294",
      }
    ],
  },
  HI: {
    name: "Hawaii",
    abbr: "HI",
    session: { status: "active", dates: "Jan 21 - May 7, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "11%", brackets: 12 },
      stateEITC: { available: true, match: "20%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  ID: {
    name: "Idaho",
    abbr: "ID",
    session: { status: "active", dates: "Jan 12 - Apr 10, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "5.8%" },
      stateEITC: { available: false },
      stateCTC: { available: true, name: "Grocery Tax Credit" },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  IL: {
    name: "Illinois",
    abbr: "IL",
    session: { status: "active", dates: "Jan 14 - May 31, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "4.95%" },
      stateEITC: { available: true, match: "20%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  IN: {
    name: "Indiana",
    abbr: "IN",
    session: { status: "active", dates: "Dec 1, 2025 - Feb 27, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "3.05%" },
      stateEITC: { available: true, match: "10%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  IA: {
    name: "Iowa",
    abbr: "IA",
    session: { status: "active", dates: "Jan 12 - Apr 21, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "3.8%" },
      stateEITC: { available: true, match: "15%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  KS: {
    name: "Kansas",
    abbr: "KS",
    session: { status: "active", dates: "Jan 12 - Apr 10, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "5.7%", brackets: 3 },
      stateEITC: { available: true, match: "17%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "high",
    activeBills: [],
  },
  KY: {
    name: "Kentucky",
    abbr: "KY",
    session: { status: "active", dates: "Jan 6 - Apr 15, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "3.5%" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "high",
    activeBills: [],
  },
  LA: {
    name: "Louisiana",
    abbr: "LA",
    session: { status: "active", dates: "Mar 9 - Jun 1, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "3%" },
      stateEITC: { available: true, match: "5%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  ME: {
    name: "Maine",
    abbr: "ME",
    session: { status: "active", dates: "Jan 7 - Apr 15, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "7.15%", brackets: 3 },
      stateEITC: { available: true, match: "25%" },
      stateCTC: { available: true, name: "Child Tax Credit" },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  MD: {
    name: "Maryland",
    abbr: "MD",
    session: { status: "active", dates: "Jan 14 - Apr 13, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "5.75%", brackets: 8 },
      stateEITC: { available: true, match: "45%" },
      stateCTC: { available: true, name: "Child Tax Credit" },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  MA: {
    name: "Massachusetts",
    abbr: "MA",
    session: { status: "active", dates: "Jan 7 - Jul 31, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "5%", note: "+ 4% millionaire surtax" },
      stateEITC: { available: true, match: "40%" },
      stateCTC: { available: true, name: "Child and Family Tax Credit" },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  MI: {
    name: "Michigan",
    abbr: "MI",
    session: { status: "active", dates: "Jan 14 - Dec 31, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "4.25%" },
      stateEITC: { available: true, match: "30%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [
      {
        bill: "Invest in MI Kids Initiative",
        status: "Proposed",
        description: "Additional 5% tax on annual taxable income to fund public schools",
        url: "https://www.michigan.gov/sos/-/media/Project/Websites/sos/BSC-Announcements/Invest-in-MI-Kids-Petition.pdf"
      }
    ],
  },
  MN: {
    name: "Minnesota",
    abbr: "MN",
    session: { status: "active", dates: "Feb 17 - May 18, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "9.85%", brackets: 4 },
      stateEITC: { available: true, name: "Working Family Credit", type: "custom" },
      stateCTC: { available: true, name: "Child Tax Credit" },
    },
    legislativeActivity: "high",
    activeBills: [],
  },
  MS: {
    name: "Mississippi",
    abbr: "MS",
    session: { status: "active", dates: "Jan 6 - Apr 5, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "4.7%" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  MO: {
    name: "Missouri",
    abbr: "MO",
    session: { status: "active", dates: "Jan 7 - May 15, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "4.8%", brackets: 10 },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  MT: {
    name: "Montana",
    abbr: "MT",
    session: { status: "interim", dates: "Odd years only" },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "5.4%", brackets: 2 },
      stateEITC: { available: true, match: "20%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  NE: {
    name: "Nebraska",
    abbr: "NE",
    session: { status: "active", dates: "Jan 7 - Apr 17, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "5.84%", brackets: 4 },
      stateEITC: { available: true, match: "10%" },
      stateCTC: { available: true, name: "Child Tax Credit" },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  NV: {
    name: "Nevada",
    abbr: "NV",
    session: { status: "interim", dates: "Odd years only" },
    policyLevers: {
      incomeTax: { available: false, note: "No state income tax" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  NH: {
    name: "New Hampshire",
    abbr: "NH",
    session: { status: "active", dates: "Jan 7 - Jun 30, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: false, note: "No wage income tax (I&D tax phasing out)" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  NJ: {
    name: "New Jersey",
    abbr: "NJ",
    session: { status: "active", dates: "Jan 13 - Dec 31, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "10.75%", brackets: 7 },
      stateEITC: { available: true, match: "40%" },
      stateCTC: { available: true, name: "Child Tax Credit" },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  NM: {
    name: "New Mexico",
    abbr: "NM",
    session: { status: "active", dates: "Jan 20 - Feb 19, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "5.9%", brackets: 5 },
      stateEITC: { available: true, match: "25%" },
      stateCTC: { available: true, name: "Child Tax Credit" },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  NY: {
    name: "New York",
    abbr: "NY",
    session: { status: "active", dates: "Jan 7 - Jun 4, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "10.9%", brackets: 9 },
      stateEITC: { available: true, match: "30%" },
      stateCTC: { available: true, name: "Empire State Child Credit" },
    },
    legislativeActivity: "high",
    activeBills: [
      {
        bill: "S.2082 (Working Families Tax Credit)",
        status: "Proposed",
        description: "New refundable credit for working families",
        url: "https://www.nysenate.gov/legislation/bills/2025/S2082"
      }
    ],
  },
  NC: {
    name: "North Carolina",
    abbr: "NC",
    session: { status: "active", dates: "Apr 21 - Aug 31, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "3.99%" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "high",
    activeBills: [],
    taxChanges: [
      { change: "Flat 3.99%", effective: "Jan 2026", impact: "Continued rate reduction", url: "https://www.ncleg.net/EnactedLegislation/Statutes/PDF/BySection/Chapter_105/GS_105-153.7.pdf" }
    ],
  },
  ND: {
    name: "North Dakota",
    abbr: "ND",
    session: { status: "interim", dates: "Odd years only" },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "2.5%", brackets: 4 },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  OH: {
    name: "Ohio",
    abbr: "OH",
    session: { status: "active", dates: "Jan 5 - Dec 31, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "2.75%" },
      stateEITC: { available: true, match: "30%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "high",
    activeBills: [],
    taxChanges: [
      { change: "Flat 2.75%", effective: "Jan 2026", impact: "-$1.1B revenue", url: "https://codes.ohio.gov/assets/laws/revised-code/authenticated/57/5747/5747.02/9-30-2025/5747.02-9-30-2025.pdf" }
    ],
  },
  OK: {
    name: "Oklahoma",
    abbr: "OK",
    session: { status: "active", dates: "Feb 2 - May 29, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "4.5%", brackets: 6 },
      stateEITC: { available: true, match: "5%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "high",
    activeBills: [
      {
        bill: "HB2229",
        status: "In Committee",
        description: "Double state EITC from 5% to 10% of federal credit",
        url: "https://www.billtrack50.com/billdetail/1788567",
        reformConfig: {
          id: "ok-hb2229-eitc",
          label: "Oklahoma HB2229: Double State EITC",
          description: "Increases Oklahoma's EITC match from 5% to 10% of the federal credit",
          year: 2026,
          reform: {
            "gov.states.ok.tax.income.credits.earned_income.eitc_fraction": {
              "2026": 0.10
            }
          }
        }
      }
    ],
  },
  OR: {
    name: "Oregon",
    abbr: "OR",
    session: { status: "active", dates: "Feb 2 - Mar 9, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "9.9%", brackets: 4 },
      stateEITC: { available: true, match: "12%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "high",
    activeBills: [
      {
        bill: "SB1507",
        status: "Proposed",
        description: "Raises EITC match rate to 17% for families with young children (from 12%) and 14% for others (from 9%)",
        url: "https://olis.oregonlegislature.gov/liz/2026R1/Measures/Overview/SB1507",
        reformConfig: {
          id: "or-sb1507-eitc-increase",
          label: "Oregon SB1507: EITC Match Rate Increase",
          description: "Increases Oregon's EITC match from 12% to 17% for families with young children and from 9% to 14% for others",
          year: 2026,
          reform: {
            "gov.states.or.tax.income.credits.eitc.match.has_young_child": {
              "2026-01-01.2100-12-31": 0.17
            },
            "gov.states.or.tax.income.credits.eitc.match.no_young_child": {
              "2026-01-01.2100-12-31": 0.14
            }
          }
        }
      }
    ],
  },
  PA: {
    name: "Pennsylvania",
    abbr: "PA",
    session: { status: "active", dates: "Jan 6 - Nov 30, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "3.07%" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  RI: {
    name: "Rhode Island",
    abbr: "RI",
    session: { status: "active", dates: "Jan 6 - Jun 30, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "5.99%", brackets: 3 },
      stateEITC: { available: true, match: "15%" },
      stateCTC: { available: false, note: "Proposed" },
    },
    legislativeActivity: "high",
    activeBills: [
      {
        bill: "Governor McKee FY2027 Budget: High Earner Tax",
        status: "Proposed",
        description: "Adds 8.99% tax bracket on income over $648,398",
        url: "https://omb.ri.gov/budget/current-budget",
      },
      {
        bill: "Governor McKee FY2027 Budget: Social Security Exemption",
        status: "Proposed",
        description: "Eliminates state income tax on Social Security benefits",
        url: "https://omb.ri.gov/budget/current-budget",
      }
    ],
  },
  SC: {
    name: "South Carolina",
    abbr: "SC",
    session: { status: "active", dates: "Jan 13 - May 7, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "6.4%", brackets: 3 },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "high",
    activeBills: [
      {
        bill: "H.4216",
        status: "Proposed",
        description: "Flat 3.99% tax proposal",
        url: "https://www.scstatehouse.gov/billsearch.php?billnumbers=4216&session=126"
      },
      {
        bill: "H.3492",
        status: "Proposed",
        description: "Makes 25% of the excess of the state's nonrefundable EITC refundable",
        url: "https://www.scstatehouse.gov/sess126_2025-2026/prever/3492_20241205.htm",
        reformConfig: {
          id: "sc-h3492-refundable-eitc",
          label: "SC H.3492 Partially Refundable EITC",
          description: "Makes 25% of the excess of South Carolina's nonrefundable EITC refundable",
          year: 2026,
          reform: {
            "gov.contrib.states.sc.h3492.in_effect": {
              "2026-01-01.2100-12-31": true
            }
          }
        }
      }
    ],
  },
  SD: {
    name: "South Dakota",
    abbr: "SD",
    session: { status: "active", dates: "Jan 13 - Mar 30, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: false, note: "No state income tax" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  TN: {
    name: "Tennessee",
    abbr: "TN",
    session: { status: "active", dates: "Jan 13 - Apr 24, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: false, note: "No state income tax" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  TX: {
    name: "Texas",
    abbr: "TX",
    session: { status: "interim", dates: "Odd years only" },
    policyLevers: {
      incomeTax: { available: false, note: "No state income tax" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  UT: {
    name: "Utah",
    abbr: "UT",
    session: { status: "active", dates: "Jan 20 - Mar 6, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "flat", topRate: "4.5%" },
      stateEITC: { available: true, match: "15%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "high",
    activeBills: [
      {
        bill: "SB60",
        status: "Proposed",
        description: "Cut income tax rate from 4.5% to 4.45%",
        url: "https://le.utah.gov/~2026/bills/static/SB60.html",
        analysisUrl: "https://www.policyengine.org/us/research/utah-sb60-income-tax-reduction",
        reformConfig: {
          id: "ut-sb60-rate-cut",
          label: "Utah Income Tax Rate Cut (SB60)",
          description: "Reduces Utah's flat income tax rate from 4.5% to 4.45%",
          year: 2026,
          reform: {
            "gov.states.ut.tax.income.rate": {
              "2026": 0.0445
            }
          }
        }
      },
      {
        bill: "HB210 (S1)",
        status: "Proposed",
        description: "Removes marriage penalties from income tax credits by setting single/HOH/MFS phaseouts to half of joint filer amounts; repeals state EITC",
        url: "https://le.utah.gov/~2026/bills/static/HB0210.html",
        reformConfig: {
          id: "ut-hb210-marriage-penalty-removal",
          label: "Utah HB210 Marriage Penalty Removal",
          description: "Removes marriage penalties from certain individual income tax credits and exemptions, increases taxpayer credit for married filers, and repeals the state EITC",
          year: 2026,
          reform: {
            "gov.contrib.states.ut.hb210.in_effect": {
              "2026-01-01.2100-12-31": true
            },
            "gov.contrib.states.ut.hb210.taxpayer_credit_add_on.amount.JOINT": {
              "2026-01-01.2100-12-31": 66.0
            },
            "gov.contrib.states.ut.hb210.taxpayer_credit_add_on.amount.SEPARATE": {
              "2026-01-01.2100-12-31": 33.0
            },
            "gov.contrib.states.ut.hb210.taxpayer_credit_add_on.amount.SURVIVING_SPOUSE": {
              "2026-01-01.2100-12-31": 66.0
            },
            "gov.states.ut.tax.income.credits.ctc.reduction.start.HEAD_OF_HOUSEHOLD": {
              "2026-01-01.2100-12-31": 27000.0
            },
            "gov.states.ut.tax.income.credits.ctc.reduction.start.SINGLE": {
              "2026-01-01.2100-12-31": 27000.0
            },
            "gov.states.ut.tax.income.credits.earned_income.rate": {
              "2026-01-01.2100-12-31": 0.0
            },
            "gov.states.ut.tax.income.credits.retirement.phase_out.threshold.HEAD_OF_HOUSEHOLD": {
              "2026-01-01.2100-12-31": 16000.0
            },
            "gov.states.ut.tax.income.credits.retirement.phase_out.threshold.SINGLE": {
              "2026-01-01.2100-12-31": 16000.0
            },
            "gov.states.ut.tax.income.credits.taxpayer.phase_out.threshold.HEAD_OF_HOUSEHOLD": {
              "2026-01-01.2100-12-31": 18625.8
            },
            "gov.states.ut.tax.income.credits.ss_benefits.phase_out.threshold.HEAD_OF_HOUSEHOLD": {
              "2026-01-01.2100-12-31": 45000.0
            },
            "gov.states.ut.tax.income.credits.ss_benefits.phase_out.threshold.SINGLE": {
              "2026-01-01.2100-12-31": 45000.0
            }
          }
        }
      },
      {
        bill: "HB290",
        status: "Proposed",
        description: "Raises CTC phaseout thresholds: Single/HOH to $49k, Joint to $61k, MFS to $30.5k",
        url: "https://le.utah.gov/~2026/bills/static/HB0290.html",
        reformConfig: {
          id: "ut-hb290-ctc-threshold-increase",
          label: "Utah HB290: CTC Phaseout Threshold Increase",
          description: "Raises the income thresholds at which Utah's Child Tax Credit begins to phase out",
          year: 2026,
          reform: {
            "gov.states.ut.tax.income.credits.ctc.reduction.start.SINGLE": {
              "2026-01-01.2100-12-31": 49000.0
            },
            "gov.states.ut.tax.income.credits.ctc.reduction.start.HEAD_OF_HOUSEHOLD": {
              "2026-01-01.2100-12-31": 49000.0
            },
            "gov.states.ut.tax.income.credits.ctc.reduction.start.JOINT": {
              "2026-01-01.2100-12-31": 61000.0
            },
            "gov.states.ut.tax.income.credits.ctc.reduction.start.SURVIVING_SPOUSE": {
              "2026-01-01.2100-12-31": 61000.0
            },
            "gov.states.ut.tax.income.credits.ctc.reduction.start.SEPARATE": {
              "2026-01-01.2100-12-31": 30500.0
            }
          }
        }
      }
    ],
  },
  VT: {
    name: "Vermont",
    abbr: "VT",
    session: { status: "active", dates: "Jan 6 - May 8, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "8.75%", brackets: 4 },
      stateEITC: { available: true, match: "38%" },
      stateCTC: { available: true, name: "Child Tax Credit" },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  VA: {
    name: "Virginia",
    abbr: "VA",
    session: { status: "active", dates: "Jan 14 - Mar 14, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "5.75%", brackets: 4 },
      stateEITC: { available: true, match: "20%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "high",
    activeBills: [
      {
        bill: "HB979",
        status: "Proposed",
        description: "Income tax reform: adds 8% bracket ($600k-$1M), 10% bracket ($1M+), increases standard deduction",
        url: "https://lis.virginia.gov/bill-details/20261/HB979",
        reformConfig: {
          id: "va-hb979-income-tax-reform",
          label: "Virginia HB979: Income Tax Reform",
          description: "Adds two new high-income tax brackets (8% on $600k-$1M, 10% on $1M+) and increases standard deductions ($10k single, $15k HOH, $20k joint)",
          year: 2027,
          reform: {
            "gov.contrib.states.va.hb979.in_effect": {
              "2027-01-01.2100-12-31": true
            },
            "gov.states.va.tax.income.deductions.standard.SINGLE": {
              "2027-01-01.2100-12-31": 10000
            },
            "gov.states.va.tax.income.deductions.standard.SEPARATE": {
              "2027-01-01.2100-12-31": 10000
            },
            "gov.states.va.tax.income.deductions.standard.SURVIVING_SPOUSE": {
              "2027-01-01.2100-12-31": 10000
            },
            "gov.states.va.tax.income.deductions.standard.HEAD_OF_HOUSEHOLD": {
              "2027-01-01.2100-12-31": 15000
            },
            "gov.states.va.tax.income.deductions.standard.JOINT": {
              "2027-01-01.2100-12-31": 20000
            }
          }
        }
      }
    ],
  },
  WA: {
    name: "Washington",
    abbr: "WA",
    session: { status: "active", dates: "Jan 12 - Mar 12, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: false, note: "No wage income tax (7% capital gains)" },
      stateEITC: { available: true, name: "Working Families Tax Credit", type: "custom" },
      stateCTC: { available: false },
    },
    legislativeActivity: "high",
    activeBills: [
      {
        bill: "Millionaires' Tax Proposal",
        status: "Proposed",
        description: "9.9% income tax on earnings over $1M",
        url: "https://governor.wa.gov/news/2025/governor-ferguson-announces-support-millionaires-tax"
      }
    ],
  },
  WV: {
    name: "West Virginia",
    abbr: "WV",
    session: { status: "active", dates: "Jan 14 - Mar 14, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "5.12%", brackets: 5 },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  WI: {
    name: "Wisconsin",
    abbr: "WI",
    session: { status: "active", dates: "Jan 13 - Mar 19, 2026", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "7.65%", brackets: 4 },
      stateEITC: { available: true, match: "11%" },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
  WY: {
    name: "Wyoming",
    abbr: "WY",
    session: { status: "active", dates: "Feb 9 - Mar 6, 2026", carryover: false },
    policyLevers: {
      incomeTax: { available: false, note: "No state income tax" },
      stateEITC: { available: false },
      stateCTC: { available: false },
    },
    legislativeActivity: "low",
    activeBills: [],
  },
  DC: {
    name: "District of Columbia",
    abbr: "DC",
    session: { status: "active", dates: "Year-round", carryover: true },
    policyLevers: {
      incomeTax: { available: true, type: "graduated", topRate: "10.75%", brackets: 7 },
      stateEITC: { available: true, match: "70%", note: "Highest in nation" },
      stateCTC: { available: false },
    },
    legislativeActivity: "moderate",
    activeBills: [],
  },
};

// Legislative activity determines map color - focused on what's happening NOW
export const activityLabels = {
  high: {
    label: "High Activity",
    color: "#dc2626",
    description: "Major tax changes or active bills"
  },
  moderate: {
    label: "Moderate",
    color: "#f59e0b",
    description: "Some legislative activity"
  },
  low: {
    label: "Low Activity",
    color: "#9ca3af",
    description: "No major tax legislation"
  },
};

// Research coverage status - what we have analyzed
export const researchLabels = {
  published: { label: "Published", color: "#22c55e" },
  in_progress: { label: "In Progress", color: "#3b82f6" },
  planned: { label: "Planned", color: "#8b5cf6" },
  none: { label: "Not Yet", color: "#e5e7eb" },
};

// Get color for map based on legislative activity
export const getStateColor = (activity) => {
  const colors = {
    high: "#dc2626",
    moderate: "#f59e0b",
    low: "#d1d5db",
  };
  return colors[activity] || "#e5e7eb";
};

// Count states by activity level
export const getActivityCounts = () => {
  const counts = { high: 0, moderate: 0, low: 0 };
  Object.values(stateData).forEach(state => {
    counts[state.legislativeActivity]++;
  });
  return counts;
};
