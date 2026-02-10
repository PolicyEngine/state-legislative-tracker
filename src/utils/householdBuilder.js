/**
 * Get state name from abbreviation
 */
export const stateNames = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

export function getStateName(abbr) {
  return stateNames[abbr] || abbr;
}

/**
 * Build a PolicyEngine-compatible household object from simple inputs
 */
export function buildHousehold({
  headAge = 35,
  isMarried = false,
  spouseAge = 35,
  income = 50000,
  spouseIncome = 0,
  childrenAges = [],
  state = "NY",
  year = "2026",
  incomeSources = {},
  expenses = {},
}) {
  const people = {};
  const memberList = [];

  // Use state abbreviation (API expects 2-letter codes like "UT", not "Utah")
  const stateCode = state;

  // Add primary adult (head of household)
  people.adult = {
    age: { [year]: headAge },
    employment_income: { [year]: income },
  };

  // Variables that belong on spm_units rather than people
  const spmUnitExpenseKeys = new Set(["childcare_expenses"]);

  // Spread additional income sources onto the adult person
  for (const [key, value] of Object.entries(incomeSources)) {
    if (value > 0) {
      people.adult[key] = { [year]: value };
    }
  }

  // Spread person-level expenses onto the adult person
  for (const [key, value] of Object.entries(expenses)) {
    if (value > 0 && !spmUnitExpenseKeys.has(key)) {
      people.adult[key] = { [year]: value };
    }
  }

  memberList.push("adult");

  // Add spouse if married
  if (isMarried) {
    people.spouse = {
      age: { [year]: spouseAge },
      employment_income: { [year]: spouseIncome },
    };
    memberList.push("spouse");
  }

  // Add children with their specific ages
  childrenAges.forEach((age, i) => {
    const childId = `child${i + 1}`;
    people[childId] = {
      age: { [year]: age },
      employment_income: { [year]: 0 },
    };
    memberList.push(childId);
  });

  // Build marital units — one unit containing all members
  const maritalUnits = {
    marital_unit: {
      members: memberList,
    },
  };

  // Build state-specific tax variable name (e.g., "ut_income_tax" for UT)
  const stateTaxVar = `${stateCode.toLowerCase()}_income_tax`;

  return {
    people,
    families: {
      family: {
        members: memberList,
      },
    },
    marital_units: maritalUnits,
    tax_units: {
      tax_unit: {
        members: memberList,
        // Request output variables
        income_tax: { [year]: null },
        [stateTaxVar]: { [year]: null },
      },
    },
    spm_units: {
      spm_unit: {
        members: memberList,
        // Spread spm_unit-level expenses (e.g. childcare_expenses)
        ...Object.fromEntries(
          Object.entries(expenses)
            .filter(([key, value]) => spmUnitExpenseKeys.has(key) && value > 0)
            .map(([key, value]) => [key, { [year]: value }])
        ),
      },
    },
    households: {
      household: {
        members: memberList,
        state_name: { [year]: stateCode },
        // Request household net income
        household_net_income: { [year]: null },
      },
    },
  };
}
