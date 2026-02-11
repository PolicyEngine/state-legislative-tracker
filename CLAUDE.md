# Claude Code Guidelines for State Legislative Tracker

## Security Rules

### CRITICAL: Supabase Credentials

**NEVER expose Supabase keys in any file that is not in .gitignore.**

- Supabase URL and API keys must ONLY be stored in `.env.local` (which is gitignored)
- When running scripts that need Supabase access, load credentials from environment variables
- Do NOT create script files in the codebase that contain hardcoded credentials
- Do NOT commit any file containing `SUPABASE_URL` or `SUPABASE_KEY` values
- For one-off database operations, use inline Python/scripts that read from `.env.local`

### Environment Variables

The following environment variables are used (stored in `.env.local`):
- `VITE_SUPABASE_URL` - Supabase project URL (for frontend)
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key (for frontend)
- `SUPABASE_URL` - Supabase project URL (for scripts)
- `SUPABASE_KEY` - Supabase service key (for scripts)

## Development Patterns

### Computing Reform Impacts

Use `scripts/compute_impacts.py` to compute impacts locally:
```bash
python scripts/compute_impacts.py --reform-id <id> --year <year>
python scripts/compute_impacts.py --reform-id <id> --year <year> --multi-year  # For multi-year analyses
```

### Multi-Year Reforms

For reforms with impacts across multiple years:
- Store year-specific impacts in `model_notes.impacts_by_year`
- Use `--multi-year` flag to preserve existing year data when adding new years
- Frontend displays year tabs when `impactsByYear` has multiple entries

### Provisions Format

Provisions in `reform_impacts.provisions` must use this structure:
```json
{
  "label": "Short title",
  "baseline": "Current value",
  "reform": "New value",
  "explanation": "Longer description"
}
```
