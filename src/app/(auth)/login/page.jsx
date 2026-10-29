"use client";

import { useEffect, useState } from "react";
import { apiErrorMessage } from "@/lib/apiError.js";
import { useRouter } from "next/navigation";
import { useFormik } from "formik";
import * as Yup from "yup";
import toast from "react-hot-toast";
import Link from "next/link";
import { ShieldCheck, Eye, EyeOff, TriangleAlert } from "lucide-react";
import TextInput from "@/components/atoms/TextInput.jsx";
import Button from "@/components/atoms/Button.jsx";
import IconButton from "@/components/atoms/IconButton.jsx";
import { getCurrentUser, isAuthenticated, login, loginWithGoogle } from "@/services/authService.js";
import GoogleSignInButton from "@/components/organisms/GoogleSignInButton.jsx";

function postLoginPath(role) {
  return role === "SUPERADMIN" ? "/organizations" : role === "PENDING" ? "/pending" : "/dashboard";
}

const LoginSchema = Yup.object({
  email: Yup.string().email("Enter a valid email address").required("Email is required"),
  password: Yup.string().required("Password is required"),
});

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) return;
    getCurrentUser()
      .then((me) => router.replace(postLoginPath(me.user.role)))
      .catch(() => {});
  }, [router]);

  const formik = useFormik({
    initialValues: { email: "", password: "" },
    validationSchema: LoginSchema,
    onSubmit: async (values) => {
      setSubmitting(true);
      try {
        const user = await login(values.email, values.password);
        router.push(postLoginPath(user.role));
      } catch (error) {
        toast.error(apiErrorMessage(error));
      } finally {
        setSubmitting(false);
      }
    },
  });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      <div className="grid w-full max-w-[1200px] grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-4 shadow-overlay lg:h-[760px] lg:grid-cols-2">
        <div className="relative hidden flex-col justify-between overflow-hidden rounded-lg bg-[#0b1b34] p-10 lg:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/login-hero.svg" alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />

          <div className="relative flex max-w-[420px] flex-col gap-3.5">
            <div className="flex items-center gap-2 text-white">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              <span className="text-sm font-bold">Lone Worker Safety</span>
            </div>
            <h2 className="text-[40px] font-bold leading-[1.1] tracking-[-0.01em] text-white">Every lone worker, in sight.</h2>
            <p className="text-sm leading-[1.55] text-[#b6c4dc]">
              Location, battery and SOS status from every Worker Node, on one console.
            </p>
          </div>

          <div
            aria-hidden="true"
            className="relative flex w-fit items-center gap-3 rounded-md bg-white/95 px-3.5 py-3 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.4)]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-[#fdecec]">
              <TriangleAlert className="h-[18px] w-[18px] text-[#dc2626]" />
            </span>
            <div>
              <p className="text-[13px] font-bold text-[#0f172a]">SOS received from W-001</p>
              <p className="text-xs text-[#667085]">Location shared, response team notified</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center p-6 sm:p-10">
          <div className="flex w-full max-w-[380px] animate-fade-up flex-col gap-7">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-white">
              <ShieldCheck className="h-[22px] w-[22px]" aria-hidden="true" />
            </span>

            <div className="flex flex-col gap-1.5">
              <h1 className="text-3xl font-semibold text-foreground">Welcome back</h1>
              <p className="text-sm text-muted-foreground">Sign in to monitor your workers</p>
            </div>

            <form onSubmit={formik.handleSubmit} noValidate className="flex flex-col gap-4">
              <TextInput
                id="email"
                name="email"
                type="email"
                label="Email"
                autoComplete="username"
                required
                className="[&_input]:!h-[42px]"
                value={formik.values.email}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                error={formik.errors.email}
                touched={formik.touched.email}
              />
              <TextInput
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                label="Password"
                autoComplete="current-password"
                required
                className="[&_input]:!h-[42px]"
                value={formik.values.password}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                error={formik.errors.password}
                touched={formik.touched.password}
                endAdornment={
                  <IconButton
                    icon={showPassword ? EyeOff : Eye}
                    label={showPassword ? "Hide password" : "Show password"}
                    className="!h-8 !w-8"
                    onClick={() => setShowPassword((value) => !value)}
                  />
                }
              />
              <div className="flex justify-end">
                <Link href="/forgot-password" className="text-xs font-medium text-text-secondary hover:text-foreground">
                  Forgot password?
                </Link>
              </div>
              <Button
                type="submit"
                className="w-full !h-[42px] !bg-[#0f172a] hover:!bg-[#1e293b] in-data-[theme=dark]:!bg-primary in-data-[theme=dark]:hover:!bg-primary-hover"
                loading={submitting}
              >
                Sign In
              </Button>
            </form>

            <div className="flex items-center gap-3 text-xs text-text-disabled" role="separator" aria-label="Or">
              <span className="h-px flex-1 bg-border" />
              Or
              <span className="h-px flex-1 bg-border" />
            </div>

            {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
              <GoogleSignInButton
                onCredential={async (idToken) => {
                  try {
                    const user = await loginWithGoogle(idToken);
                    router.push(postLoginPath(user.role));
                  } catch (error) {
                    toast.error(apiErrorMessage(error));
                  }
                }}
              />
            ) : (
              <Button
                type="button"
                variant="secondary"
                className="w-full !h-[42px]"
                onClick={() => toast.error("Google sign-in is currently unavailable.")}
              >
                <GoogleG />
                Continue with Google
              </Button>
            )}

            <p className="text-center text-xs text-muted-foreground">
              Accounts are created by a Super Admin. Contact yours if you can&apos;t sign in.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
