import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { getDescription } from '../data/analysisDescriptions';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [research, setResearch] = useState([]);
  const [reformImpacts, setReformImpacts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchData() {
      if (!supabase) {
        setError('Supabase not configured');
        setLoading(false);
        return;
      }

      try {
        const [researchResult, impactsResult] = await Promise.all([
          supabase.from('research').select('*'),
          supabase.from('reform_impacts').select('*'),
        ]);

        if (researchResult.error) throw researchResult.error;
        if (impactsResult.error) throw impactsResult.error;

        setResearch(researchResult.data || []);

        // Convert impacts to dict with camelCase
        const impactsDict = {};
        for (const item of impactsResult.data || []) {
          // Parse model_notes if it's a string (Supabase sometimes returns JSON as string)
          let modelNotes = item.model_notes;
          if (typeof modelNotes === 'string') {
            try {
              modelNotes = JSON.parse(modelNotes);
            } catch (e) {
              console.error('Failed to parse model_notes:', e);
              modelNotes = {};
            }
          }
          modelNotes = modelNotes || {};

          // Parse provisions if it's a string
          let provisions = item.provisions;
          if (typeof provisions === 'string') {
            try {
              provisions = JSON.parse(provisions);
            } catch (e) {
              console.error('Failed to parse provisions:', e);
              provisions = [];
            }
          }

          impactsDict[item.id] = {
            computed: item.computed,
            computedAt: item.computed_at,
            policyId: item.policy_id,
            budgetaryImpact: item.budgetary_impact,
            povertyImpact: item.poverty_impact,
            childPovertyImpact: item.child_poverty_impact,
            winnersLosers: item.winners_losers,
            decileImpact: item.decile_impact,
            inequality: item.inequality,
            districtImpacts: item.district_impacts,
            reformParams: item.reform_params,
            provisions: provisions,
            modelNotes: modelNotes,
            analysisYear: modelNotes?.analysis_year,
            impactsByYear: modelNotes?.impacts_by_year,
            policyengineUsVersion: item.policyengine_us_version,
            datasetVersion: item.dataset_version,
          };
        }
        setReformImpacts(impactsDict);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const statesWithBills = useMemo(() => {
    const counts = {};
    for (const item of research) {
      if (item.type === 'bill' && item.status !== 'in_review' && item.state) {
        counts[item.state] = (counts[item.state] || 0) + 1;
      }
    }
    return counts;
  }, [research]);

  // Get bills for a state (type === 'bill')
  const getBillsForState = (stateAbbr) => {
    return research
      .filter(item => item.state === stateAbbr && item.type === 'bill' && item.status !== 'in_review')
      .map(item => {
        const impact = reformImpacts[item.id];
        const description = getDescription(item.id) || item.description;
        return {
          id: item.id,
          bill: extractBillNumber(item.id, item.title),
          title: item.title,
          description: description,
          url: item.url,
          status: formatStatus(item.status),
          reformConfig: impact?.reformParams ? {
            id: item.id,
            label: item.title,
            description: description,
            reform: impact.reformParams,
          } : null,
          impact: impact,
        };
      });
  };

  // Get research for a state (excluding type === 'bill')
  const getResearchForState = (stateAbbr) => {
    return research.filter(item => {
      if (item.status === 'in_review') return false;
      // Include if it's this state's research (not a bill)
      if (item.state === stateAbbr && item.type !== 'bill') return true;
      // Include if it's federal and relevant to this state
      if (item.state === 'all') return true;
      if (item.relevant_states?.includes(stateAbbr)) return true;
      return false;
    }).map(item => ({
      id: item.id,
      state: item.state,
      type: item.type,
      status: item.status,
      title: item.title,
      url: item.url,
      description: item.description,
      date: item.date,
      author: item.author,
      keyFindings: item.key_findings,
      tags: item.tags,
      relevantStates: item.relevant_states,
      federalToolOrder: item.federal_tool_order,
    }));
  };

  // Get impact for a bill
  const getImpact = (billId) => reformImpacts[billId] || null;

  return (
    <DataContext.Provider value={{
      research,
      reformImpacts,
      loading,
      error,
      statesWithBills,
      getBillsForState,
      getResearchForState,
      getImpact,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}

function extractBillNumber(id, title) {
  // Match bill patterns like HB290, SB1507, H.3492, HB210 S2 but exclude FY (fiscal year)
  const titleMatch = title?.match(/\b(?!FY)([A-Z]{1,3}\.?\s*\d+(?:\s*S\d+)?)/i);
  if (titleMatch) return titleMatch[1].replace(/\s+/g, ' ').replace('.', '').toUpperCase();
  // For budget proposals and items without bill numbers, use a clean version of the title
  if (title && !title.match(/\b[A-Z]{1,2}\d+\b/)) {
    // Extract first part before colon or parenthesis as the "bill" name
    const cleanTitle = title.split(/[:(]/)[0].trim();
    if (cleanTitle.length <= 40) return cleanTitle;
  }
  const parts = id.split('-');
  if (parts.length >= 2) return parts.slice(1).join('-').toUpperCase();
  return id.toUpperCase();
}

function formatStatus(status) {
  const map = {
    published: 'Published',
    in_progress: 'In Progress',
    in_review: 'In Review',
    planned: 'Planned',
    not_modelable: 'Not Modelable',
  };
  return map[status] || status;
}
