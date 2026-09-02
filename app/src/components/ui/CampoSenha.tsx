"use client";

import { useId, useState } from "react";

/**
 * Campo de senha com olho para mostrar e ocultar.
 *
 * Vale para senha e para credencial colada de outro lugar: sem poder conferir,
 * a pessoa erra a digitação e o sistema só reclama depois, com uma mensagem
 * que não fala de digitação.
 *
 * O botão fica fora da ordem de tabulação de propósito — quem navega pelo
 * teclado quer ir do campo para o botão de enviar, não para o olho.
 */
export function CampoSenha({
  value,
  onChange,
  placeholder,
  required,
  autoComplete = "current-password",
  className = "",
  style,
  disabled,
  minLength,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  minLength?: number;
  onEnter?: () => void;
}) {
  const [visivel, setVisivel] = useState(false);
  const id = useId();

  return (
    <span className="relative block">
      <input
        id={id}
        type={visivel ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) onEnter();
        }}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        minLength={minLength}
        autoComplete={autoComplete}
        className={`w-full pr-10 ${className}`}
        style={style}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisivel((v) => !v)}
        aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={visivel}
        title={visivel ? "Ocultar" : "Mostrar"}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center opacity-60 transition hover:opacity-100"
      >
        {visivel ? <OlhoFechado /> : <OlhoAberto />}
      </button>
    </span>
  );
}

function OlhoAberto() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function OlhoFechado() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7c1.9 0 3.5.6 4.9 1.4M22 12s-3.6 7-10 7c-1.9 0-3.5-.6-4.9-1.4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
