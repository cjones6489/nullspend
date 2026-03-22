const steps = [
  {
    number: "1",
    title: "Point your SDK",
    description: "Change your base URL to proxy.nullspend.com. One environment variable.",
  },
  {
    number: "2",
    title: "Add one header",
    description: "X-NullSpend-Key authenticates requests. Your provider keys pass through untouched.",
  },
  {
    number: "3",
    title: "See costs instantly",
    description: "Every request is tracked, budgeted, and visible in your dashboard and via webhooks.",
  },
];

export function HowItWorks() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Up and running in two minutes
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
          {steps.map((step, i) => (
            <div key={step.number} className="relative flex flex-col items-center text-center">
              {/* Connector line (desktop only) */}
              {i < steps.length - 1 && (
                <div className="absolute top-5 left-[calc(50%+28px)] hidden h-px w-[calc(100%-56px)] bg-border/50 md:block" />
              )}

              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-sm font-bold text-primary">
                {step.number}
              </div>
              <h3 className="mt-4 text-sm font-medium">{step.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
