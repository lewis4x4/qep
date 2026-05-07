# Reply to Rylee — QRM Quote Tool Feedback

**To:** Rylee McKenzie <rylee@qepusa.com>
**From:** Brian Lewis <brian@blackrockai.co>
**Re:** Re: QRM quoting tool ideas

---

**Subject:** QRM Quote Tool Feedback Confirmed

Hey Rylee,

Got your notes. This is exactly the level of detail I needed to lock the quote tool down, and most of it lines up with where we're already heading.

First, on the wizard format. Yes, that's the direction. Single step focus with a slide forward to the next step instead of one long scroll. Each step gets its own screen with a progress bar across the top so the rep always knows where they are and can jump back to edit any prior step. Easier on the eyes and easier to train a new rep on.

Second, on tax. Florida 6% state tax on the post trade subtotal is in. We'll add a county tax module that pulls the discretionary surtax based on the customer's delivery county and caps it correctly. The Florida surtax only applies to the first $5,000 of the sale per statute, so the system has to enforce that cap, not just multiply through. Tax exempt customers with valid resale certificates skip the calculation entirely. The manual override stays for the edge cases.

Third, on send and preview. You're right, that section needs to live below the margin waterfall as a dedicated send panel with three clear actions. Preview Quote opens the branded PDF in a new pane. Email Quote opens an editable email window with the customer prefilled and the rep BCC'd automatically. Text Quote sends a short message with a PDF link through Twilio. That replaces the small Send Quote box that's there now.

Fourth, on the 11 step structure. It lines up with what we've been building toward. Five things I need to flag.

The lease quoting piece for FMV and FPPO leases is net new scope. I need the lease rate sheets you use today, the OEMs you lease through, and any residual tables you have. Once I have those, I'll build the lease scenarios into Step 7 alongside the financing options.

The trade step references your Trade SOP. Send me the SOP or your process notes so I can wire the inspection fields and the manager approval threshold to match how your team already works.

The deposit requirement in Step 8 needs the deposit SOP. Same ask.

The quote expiration default is going in at 30 days unless you tell me otherwise.

The follow up date in Step 11 will be a required field that defaults to three days out and is editable. Forces a next step like you described.

Fifth, on the manager approval gate in Step 9. It will route to the sales manager when margin is below the floor, when trade credit is above a threshold, or when any rep applied discount exceeds a configurable percent. Send me the floor, the trade threshold, and the discount cap numbers you want enforced.

One more thing. The "Why This Machine" narrative field in Step 8 is a strong addition. I'll have it pre suggest a draft based on the discovery notes already on the customer record so the rep isn't writing it from scratch every time.

I'll get the updated build spec to the team and route the new lease quoting work into the pipeline. From you I need the lease rate sheets, the Trade SOP, the deposit SOP, and the margin, trade, and discount thresholds whenever you can pull them together.

Thanks,
Brian Lewis
BlackRock AI
