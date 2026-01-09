import { colors, typography, spacing } from "../../designTokens";

const inputStyle = {
  width: "100%",
  padding: `${spacing.sm} ${spacing.md}`,
  border: `1px solid ${colors.border.light}`,
  borderRadius: spacing.radius.lg,
  fontSize: typography.fontSize.sm,
  fontFamily: typography.fontFamily.body,
  color: colors.secondary[900],
  backgroundColor: colors.white,
  outline: "none",
  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
};

const labelStyle = {
  display: "block",
  marginBottom: spacing.xs,
  color: colors.text.secondary,
  fontSize: typography.fontSize.xs,
  fontWeight: typography.fontWeight.medium,
  fontFamily: typography.fontFamily.body,
};

const smallInputStyle = {
  ...inputStyle,
  width: "80px",
  textAlign: "center",
};

export default function HouseholdForm({
  values,
  onChange,
  onSubmit,
  loading,
  stateAbbr
}) {
  const handleChange = (field) => (e) => {
    const value = field === "income" || field === "headAge" || field === "spouseAge"
      ? parseInt(e.target.value, 10) || 0
      : field === "isMarried"
        ? e.target.checked
        : e.target.value;
    onChange({ ...values, [field]: value });
  };

  const handleChildAgeChange = (index) => (e) => {
    const age = parseInt(e.target.value, 10) || 0;
    const newChildrenAges = [...values.childrenAges];
    newChildrenAges[index] = age;
    onChange({ ...values, childrenAges: newChildrenAges });
  };

  const addChild = () => {
    if (values.childrenAges.length < 6) {
      onChange({ ...values, childrenAges: [...values.childrenAges, 10] });
    }
  };

  const removeChild = (index) => {
    const newChildrenAges = values.childrenAges.filter((_, i) => i !== index);
    onChange({ ...values, childrenAges: newChildrenAges });
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      style={{ display: "flex", flexDirection: "column", gap: spacing.lg }}
    >
      {/* Marital Status */}
      <div>
        <label style={{
          ...labelStyle,
          display: "flex",
          alignItems: "center",
          gap: spacing.sm,
          cursor: "pointer",
          marginBottom: 0,
        }}>
          <input
            type="checkbox"
            checked={values.isMarried}
            onChange={handleChange("isMarried")}
            style={{
              width: "18px",
              height: "18px",
              cursor: "pointer",
              accentColor: colors.primary[600],
            }}
          />
          <span style={{ fontSize: typography.fontSize.sm, color: colors.secondary[900] }}>
            Married
          </span>
        </label>
      </div>

      {/* Ages - Side by Side */}
      <div style={{
        display: "grid",
        gridTemplateColumns: values.isMarried ? "1fr 1fr" : "1fr",
        gap: spacing.md,
      }}>
        <div>
          <label style={labelStyle}>Your Age</label>
          <input
            type="number"
            value={values.headAge}
            onChange={handleChange("headAge")}
            min={18}
            max={100}
            style={{ ...inputStyle, width: "100%" }}
          />
        </div>
        {values.isMarried && (
          <div>
            <label style={labelStyle}>Spouse Age</label>
            <input
              type="number"
              value={values.spouseAge}
              onChange={handleChange("spouseAge")}
              min={18}
              max={100}
              style={{ ...inputStyle, width: "100%" }}
            />
          </div>
        )}
      </div>

      {/* Income */}
      <div>
        <label style={labelStyle}>Annual Household Employment Income</label>
        <div style={{ position: "relative" }}>
          <span style={{
            position: "absolute",
            left: spacing.md,
            top: "50%",
            transform: "translateY(-50%)",
            color: colors.text.tertiary,
            fontSize: typography.fontSize.sm,
          }}>$</span>
          <input
            type="number"
            value={values.income}
            onChange={handleChange("income")}
            min={0}
            max={10000000}
            step={1000}
            style={{ ...inputStyle, paddingLeft: spacing["2xl"] }}
            placeholder="50000"
          />
        </div>
      </div>

      {/* Children */}
      <div>
        <label style={{ ...labelStyle, marginBottom: spacing.sm }}>
          Children
        </label>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: spacing.sm,
        }}>
          {values.childrenAges.map((age, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: spacing.xs,
                padding: spacing.sm,
                backgroundColor: colors.background.secondary,
                borderRadius: spacing.radius.lg,
                position: "relative",
              }}
            >
              <button
                type="button"
                onClick={() => removeChild(index)}
                style={{
                  position: "absolute",
                  top: "4px",
                  right: "4px",
                  padding: "2px 6px",
                  border: "none",
                  borderRadius: spacing.radius.md,
                  backgroundColor: "transparent",
                  color: colors.text.tertiary,
                  cursor: "pointer",
                  fontSize: typography.fontSize.xs,
                  lineHeight: 1,
                }}
                title="Remove child"
              >
                ×
              </button>
              <span style={{
                fontSize: typography.fontSize.xs,
                fontFamily: typography.fontFamily.body,
                color: colors.text.tertiary,
              }}>
                Child {index + 1}
              </span>
              <input
                type="number"
                value={age}
                onChange={handleChildAgeChange(index)}
                min={0}
                max={17}
                style={{
                  ...smallInputStyle,
                  width: "60px",
                  padding: spacing.xs,
                }}
                placeholder="Age"
              />
            </div>
          ))}
          {values.childrenAges.length < 6 && (
            <button
              type="button"
              onClick={addChild}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: spacing.sm,
                border: `1px dashed ${colors.border.medium}`,
                borderRadius: spacing.radius.lg,
                backgroundColor: "transparent",
                color: colors.primary[600],
                fontSize: typography.fontSize.xs,
                fontWeight: typography.fontWeight.medium,
                fontFamily: typography.fontFamily.body,
                cursor: "pointer",
                transition: "all 0.15s ease",
                minHeight: "70px",
              }}
            >
              + Add
            </button>
          )}
        </div>
      </div>

      {/* State (fixed for state-specific reforms) */}
      <div>
        <label style={labelStyle}>State</label>
        <input
          type="text"
          value={stateAbbr}
          disabled
          style={{
            ...inputStyle,
            backgroundColor: colors.background.tertiary,
            color: colors.text.secondary,
            cursor: "not-allowed"
          }}
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        style={{
          width: "100%",
          padding: `${spacing.md} ${spacing.lg}`,
          border: "none",
          borderRadius: spacing.radius.lg,
          backgroundColor: loading ? colors.gray[400] : colors.primary[600],
          color: colors.white,
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          fontFamily: typography.fontFamily.primary,
          cursor: loading ? "not-allowed" : "pointer",
          transition: "background-color 0.15s ease",
        }}
        onMouseEnter={(e) => !loading && (e.currentTarget.style.backgroundColor = colors.primary[700])}
        onMouseLeave={(e) => !loading && (e.currentTarget.style.backgroundColor = colors.primary[600])}
      >
        {loading ? "Calculating..." : "Calculate Impact"}
      </button>
    </form>
  );
}
