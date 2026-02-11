"""
Modal deployment for State Research Tracker.

Builds from GitHub main branch.
Deploy with: modal deploy modal_app.py
"""

import modal

app = modal.App("state-research-tracker")

REPO_URL = "https://github.com/PolicyEngine/state-legislative-tracker.git"
BRANCH = "main"

# Image that clones repo, installs deps, and builds
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("curl", "ca-certificates", "git")
    .run_commands(
        # Install Node.js 20
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
    )
    .run_commands(
        # Clone repo and build - date command busts cache on each deploy
        "date && echo 'v8'",
        f"git clone --branch {BRANCH} --single-branch {REPO_URL} /app",
        "cd /app && npm install --legacy-peer-deps",
        # Anon key is public (read-only, row-level security enforced)
        "cd /app && VITE_SUPABASE_URL=https://ffgngqlgfsvqartilful.supabase.co"
        " VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmZ25ncWxnZnN2cWFydGlsZnVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MjQ4OTgsImV4cCI6MjA4NDAwMDg5OH0.FprGrDgkfT0j3nK51VGtCozs6y1pfhtZ07qDUHBm8Go"
        " npm run build",
    )
    .pip_install("fastapi", "uvicorn", "aiofiles")
)


@app.function(
    image=image,
    allow_concurrent_inputs=100,
)
@modal.asgi_app(label="state-legislative-tracker")
def web():
    """Serve static files with FastAPI."""
    from fastapi import FastAPI
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse
    import os

    api = FastAPI()

    dist_path = "/app/dist"

    # Serve static assets
    if os.path.exists(f"{dist_path}/assets"):
        api.mount("/assets", StaticFiles(directory=f"{dist_path}/assets"), name="assets")

    @api.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the SPA - return index.html for all routes."""
        file_path = f"{dist_path}/{full_path}"

        # If it's a file that exists, serve it
        if os.path.isfile(file_path):
            return FileResponse(file_path)

        # Otherwise serve index.html (SPA routing)
        return FileResponse(f"{dist_path}/index.html")

    return api
