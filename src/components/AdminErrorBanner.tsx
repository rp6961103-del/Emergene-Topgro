import React from 'react';
import { AlertCircle, RefreshCw, LogIn } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError } from '../services/api.ts';

interface AdminErrorBannerProps {
  error: ApiError | Error | string | null;
  onRetry?: () => void;
  title?: string;
}

export const AdminErrorBanner: React.FC<AdminErrorBannerProps> = ({
  error,
  onRetry,
  title = 'Failed to load administrative data'
}) => {
  if (!error) return null;

  const isApiError = error instanceof ApiError;
  const status = isApiError ? error.status : undefined;
  const requestId = isApiError ? error.requestId : undefined;
  const isAuthError = status === 401 || status === 403;

  let displayMessage = typeof error === 'string' ? error : error.message;

  if (status === 401) {
    displayMessage = 'Your administrator session has expired or is invalid. Please sign in again to continue.';
  } else if (status === 403) {
    displayMessage = 'Access denied: Your account does not have administrator privileges for this operation.';
  }

  return (
    <div className="p-4 sm:p-5 bg-red-50/90 border border-red-200 rounded-2xl shadow-xs space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0 mt-0.5">
          <AlertCircle className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-red-900">{title}</h3>
          <p className="text-xs text-red-700 mt-1 leading-relaxed">{displayMessage}</p>
          {requestId && (
            <p className="text-[10px] font-mono text-red-500 mt-1">
              Reference Request ID: {requestId}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-red-200/60">
        {isAuthError ? (
          <Link
            to="/admin/login"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign In to Admin Portal</span>
          </Link>
        ) : onRetry ? (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Try Again</span>
          </button>
        ) : null}
      </div>
    </div>
  );
};
