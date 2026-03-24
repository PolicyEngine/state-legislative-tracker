import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function createLocalBillRequestPlugin(env) {
  return {
    name: 'local-bill-request-api',
    configureServer(server) {
      server.middlewares.use('/api/bill-analysis-request', async (req, res, next) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        const supabaseUrl = env.SUPABASE_URL
        const supabaseKey = env.SUPABASE_KEY
        if (!supabaseUrl || !supabaseKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ detail: 'Local request handling is not configured.' }))
          return
        }

        try {
          const body = await new Promise((resolve, reject) => {
            let raw = ''
            req.on('data', (chunk) => {
              raw += chunk
            })
            req.on('end', () => resolve(raw))
            req.on('error', reject)
          })

          const payload = JSON.parse(body)
          const response = await fetch(`${supabaseUrl}/rest/v1/bill_analysis_requests`, {
            method: 'POST',
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              Prefer: 'return=representation',
            },
            body: JSON.stringify({
              state: payload.state,
              bill_number: payload.bill_number,
              title: payload.title,
              bill_url: payload.bill_url,
              requester_email: payload.requester_email,
              subscribe_newsletter: payload.subscribe_newsletter,
              request_source: payload.request_source,
              origin: 'http://127.0.0.1:4176',
              user_agent: req.headers['user-agent'] || null,
            }),
          })

          if (!response.ok) {
            const text = await response.text()
            throw new Error(text || 'Could not store request.')
          }

          let notificationSent = false
          const resendApiKey = env.RESEND_API_KEY
          if (resendApiKey) {
            const notificationTo = env.BILL_REQUEST_NOTIFICATION_TO || 'hello@policyengine.org,pavel@policyengine.org'
            const recipients = notificationTo.split(',').map((email) => email.trim()).filter(Boolean)

            const emailResponse = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'PolicyEngine Team <hello@policyengine.org>',
                to: recipients,
                subject: `Score bill request: ${payload.state} ${payload.bill_number}`,
                html: [
                  '<p>A new bill analysis request was submitted.</p>',
                  `<p><strong>Requester:</strong> ${payload.requester_email}</p>`,
                  `<p><strong>Newsletter opt-in:</strong> ${payload.subscribe_newsletter ? 'yes' : 'no'}</p>`,
                  `<p><strong>Source:</strong> ${payload.request_source || 'unknown'}</p>`,
                  `<p><strong>Bill:</strong> ${payload.state} ${payload.bill_number}</p>`,
                  `<p><strong>Title:</strong> ${payload.title}</p>`,
                  `<p><strong>Link:</strong> <a href="${payload.bill_url}">${payload.bill_url}</a></p>`,
                ].join(''),
              }),
            })

            if (!emailResponse.ok) {
              const text = await emailResponse.text()
              throw new Error(text || 'Could not send notification email.')
            }

            notificationSent = true
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ stored: true, notification_sent: notificationSent, local_dev: true }))
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ detail: error.message || 'Could not submit request.' }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss(), createLocalBillRequestPlugin(env)],
    build: { assetsDir: '_tracker' },
    server: {
      proxy: {
        '/ingest': {
          target: 'https://us.i.posthog.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/ingest/, ''),
        },
      },
    },
  }
})
