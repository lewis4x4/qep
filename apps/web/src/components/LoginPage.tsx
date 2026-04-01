import { useState, useEffect } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  HardHat,
  KeyRound,
  Mail,
  MapPin,
  ShieldCheck,
  Truck,
  Wrench,
} from "lucide-react";
import qepLoginYardHero from "@/assets/qep-login-yard-hero.svg";
import { BRAND_NAME, BrandLogo } from "@/components/BrandLogo";
import { supabase } from "../lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

interface LoginPageProps {
  authError?: string | null;
}

const HERO_METRICS = [
  { label: "Branches connected", value: "3 live", icon: Building2 },
  { label: "Field follow-up", value: "< 2 min", icon: Truck },
  { label: "Quote turnaround", value: "Same day", icon: Wrench },
];

export function LoginPage({ authError }: LoginPageProps) {
  const { toast, dismiss } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    dismiss();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePasswordLogin(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast({
        variant: "destructive",
        title: "Sign-in failed",
        description: error.message,
      });
    }
    setLoading(false);
  }

  async function handleMagicLink(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      toast({
        variant: "destructive",
        title: "Couldn't send magic link",
        description: error.message,
      });
    } else {
      toast({
        title: "Check your email",
        description: `We sent a login link to ${email}`,
      });
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(232,119,34,0.14),_transparent_28%),linear-gradient(135deg,_#08111F_0%,_#101A2C_52%,_#162134_100%)] px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-7xl items-stretch">
        <div className="grid w-full overflow-hidden rounded-[28px] border border-white/10 bg-[#0B1322] shadow-[0_40px_120px_rgba(0,0,0,0.45)] lg:grid-cols-[1.12fr_0.88fr]">
          <section className="order-2 relative overflow-hidden border-t border-white/10 bg-[linear-gradient(160deg,_rgba(27,42,61,0.98)_0%,_rgba(19,31,49,0.96)_55%,_rgba(12,21,34,0.98)_100%)] p-6 sm:p-8 lg:order-1 lg:border-r lg:border-t-0 lg:border-white/10 lg:p-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(232,119,34,0.22),_transparent_30%),radial-gradient(circle_at_bottom_left,_rgba(96,165,250,0.14),_transparent_28%)]" />
            <div className="absolute inset-y-0 right-0 w-px bg-white/10" />
            <div className="absolute left-8 top-8 h-24 w-24 rounded-full bg-primary/12 blur-3xl" />
            <div className="absolute bottom-12 right-8 h-32 w-32 rounded-full bg-[#38A169]/12 blur-3xl" />

            <div className="relative z-10 flex h-full flex-col justify-between gap-8">
              <div className="space-y-6">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="rounded-2xl bg-black/40 p-2 shadow-[0_18px_40px_rgba(0,0,0,0.35)] ring-1 ring-white/10">
                    <BrandLogo className="h-11 w-auto max-w-[min(100%,220px)] sm:h-12" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-semibold tracking-tight text-white">{BRAND_NAME}</p>
                    <p className="text-sm text-slate-300">Dealership operating system</p>
                  </div>
                </div>

                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-200">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  Built for the yard, counter, and close
                </div>

                <div className="max-w-2xl space-y-4">
                  <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-[3.6rem] lg:leading-[1.02]">
                    Equipment intelligence that feels at home in a dealership.
                  </h1>
                  <p className="max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
                    Quotes, customer history, field notes, and follow-up all in one system. Built for sales reps,
                    parts, service, rentals, and management without the usual CRM clutter.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="relative hidden overflow-hidden rounded-[26px] border border-white/10 bg-[#10192A] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] lg:block">
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(255,255,255,0.04),_transparent_25%)]" />
                  <div className="relative mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Live dealership view</p>
                      <p className="mt-1 text-sm text-slate-300">A login screen with a real operating-system feel, not stock SaaS filler.</p>
                    </div>
                    <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                      Field ready
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#0B1322]">
                    <div className="relative aspect-[4/3] bg-[linear-gradient(180deg,_#304563_0%,_#1A2D45_34%,_#182232_62%,_#0B1322_100%)]">
                      <img
                        src={qepLoginYardHero}
                        alt={`Stylized ${BRAND_NAME} dealership yard with equipment, service building, and machines ready for the day.`}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(11,19,34,0.08)_0%,_rgba(11,19,34,0.2)_48%,_rgba(10,18,30,0.72)_100%)]" />
                      <div className="absolute inset-x-0 bottom-0 h-[44%] bg-[linear-gradient(180deg,_rgba(19,31,49,0)_0%,_rgba(9,15,24,0.25)_32%,_#0A121E_100%)]" />
                      <div className="absolute left-4 top-4 rounded-2xl border border-white/10 bg-[#0A121E]/78 px-3 py-2 backdrop-blur">
                        <div className="flex items-center gap-2 text-xs text-slate-200">
                          <MapPin className="h-3.5 w-3.5 text-primary" />
                          Lake City operations
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">Sales, parts, rentals, and service on one screen.</p>
                      </div>

                      <div className="absolute bottom-4 left-4 max-w-[60%] rounded-2xl border border-white/10 bg-[#0A121E]/82 px-3 py-2 backdrop-blur">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                          Sales to service, one system
                        </p>
                        <p className="mt-1 text-sm font-medium text-white">
                          A dealership login screen should look like the business it runs.
                        </p>
                      </div>

                      <div className="absolute bottom-4 right-4 rounded-2xl border border-white/10 bg-[#0A121E]/82 px-3 py-2 backdrop-blur">
                        <div className="flex items-center gap-2 text-xs text-emerald-200">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Customer follow-up live
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">Ready for real dealership photography later.</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  {HERO_METRICS.map((metric) => {
                    const Icon = metric.icon;
                    return (
                      <Card
                        key={metric.label}
                        className="border-white/10 bg-white/[0.04] text-white shadow-none backdrop-blur"
                      >
                        <CardContent className="flex items-start gap-3 p-4">
                          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/8 text-primary">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{metric.label}</p>
                            <p className="mt-1 text-lg font-semibold text-white">{metric.value}</p>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="order-1 flex items-center bg-[linear-gradient(180deg,_#111B2D_0%,_#0C1524_100%)] p-5 sm:p-8 lg:order-2 lg:p-10">
            <div className="mx-auto w-full max-w-md">
              <div className="mb-8 space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                  <HardHat className="h-3.5 w-3.5 text-primary" />
                  Secure operator access
                </div>

                <div>
                  <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-[2.9rem] sm:leading-[1.02]">
                    Welcome back
                  </h2>
                  <p className="mt-3 max-w-md text-base leading-7 text-slate-400">
                    Sign in with your {BRAND_NAME} work account to access knowledge, CRM follow-up, voice capture, and
                    quotes.
                  </p>
                </div>

                {authError && (
                  <div
                    className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
                    role="alert"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{authError}</span>
                  </div>
                )}
              </div>

              <Card className="border-white/10 bg-white/[0.04] shadow-[0_30px_80px_rgba(0,0,0,0.28)] backdrop-blur">
                <CardContent className="p-5 sm:p-6">
                  <Tabs defaultValue="password">
                    <TabsList className="mb-6 grid w-full grid-cols-2 border border-white/10 bg-[#0A121E] p-1">
                      <TabsTrigger value="password" className="data-[state=active]:bg-primary data-[state=active]:text-white">
                        Password
                      </TabsTrigger>
                      <TabsTrigger value="magic" className="data-[state=active]:bg-primary data-[state=active]:text-white">
                        Magic link
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="password" className="mt-0">
                      <form onSubmit={handlePasswordLogin} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="email-pw" className="text-sm font-medium text-slate-200">
                            Email address
                          </Label>
                          <div className="relative">
                            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                            <Input
                              id="email-pw"
                              type="email"
                              autoComplete="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="you@qepusa.com"
                              required
                              className="h-12 border-white/10 bg-[#09111D] pl-10 text-white placeholder:text-slate-500"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="password" className="text-sm font-medium text-slate-200">
                            Password
                          </Label>
                          <div className="relative">
                            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                            <Input
                              id="password"
                              type="password"
                              autoComplete="current-password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="Enter your password"
                              required
                              className="h-12 border-white/10 bg-[#09111D] pl-10 text-white placeholder:text-slate-500"
                            />
                          </div>
                        </div>

                        <Button
                          id="login-button"
                          type="submit"
                          className="h-12 w-full gap-2 bg-primary text-base font-semibold text-white hover:bg-[#D96C1D]"
                          disabled={loading}
                        >
                          {loading ? "Signing In..." : "Sign In"}
                          {!loading && <ArrowRight className="h-4 w-4" />}
                        </Button>
                      </form>
                    </TabsContent>

                    <TabsContent value="magic" className="mt-0">
                      <form onSubmit={handleMagicLink} className="space-y-4">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                          Send a secure login link to your work email. Best when you are away from your password manager.
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="email-magic" className="text-sm font-medium text-slate-200">
                            Email address
                          </Label>
                          <div className="relative">
                            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                            <Input
                              id="email-magic"
                              type="email"
                              autoComplete="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="you@qepusa.com"
                              required
                              className="h-12 border-white/10 bg-[#09111D] pl-10 text-white placeholder:text-slate-500"
                            />
                          </div>
                        </div>

                        <Button
                          type="submit"
                          className="h-12 w-full gap-2 bg-primary text-base font-semibold text-white hover:bg-[#D96C1D]"
                          disabled={loading}
                        >
                          {loading ? "Sending..." : "Send Magic Link"}
                          {!loading && <ArrowRight className="h-4 w-4" />}
                        </Button>
                      </form>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-slate-400">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Role-based access enforced
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  Built for the field and the front office
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
