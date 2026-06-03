// @ts-nocheck
import { useCallback } from "react";
import type { ScheduledJobUpdateRequest } from "@apreal/shared";
import { getErrorMessage } from "./chat-client-utils";

export function useChatClientRequestActions(options: any) {
	const { loadingJobsRef, setLoadingJobs, setLastError, sendClientMessageRef, loadingProvidersRef, setLoadingProviders, loadingJobRunsByJobIdRef, setLoadingJobRunsByJobId, sendClientMessage } = options;
  const refreshJobs = useCallback(async () => {
    if (loadingJobsRef.current) {
      return;
    }

    setLoadingJobs((previous) => (previous ? previous : true));
    setLastError(null);

    try {
      await sendClientMessageRef.current({ type: "load_jobs" });
    } catch (error) {
      setLoadingJobs(false);
      const message = getErrorMessage(error);
      setLastError(message);
      throw new Error(message);
    }
  }, []);

  const refreshProviders = useCallback(async () => {
    if (loadingProvidersRef.current) {
      return;
    }

    setLoadingProviders((previous) => (previous ? previous : true));
    setLastError(null);

    try {
      await sendClientMessageRef.current({ type: "load_providers" });
    } catch (error) {
      setLoadingProviders(false);
      const message = getErrorMessage(error);
      setLastError(message);
      throw new Error(message);
    }
  }, []);

  const refreshJobRuns = useCallback(async (jobId: string) => {
    if (loadingJobRunsByJobIdRef.current[jobId]) {
      return;
    }

    setLoadingJobRunsByJobId((previous) => {
      if (previous[jobId]) {
        return previous;
      }

      return {
        ...previous,
        [jobId]: true,
      };
    });
    setLastError(null);

    try {
      await sendClientMessageRef.current({ type: "load_job_runs", jobId });
    } catch (error) {
      setLoadingJobRunsByJobId((previous) => {
        if (!previous[jobId]) {
          return previous;
        }

        return {
          ...previous,
          [jobId]: false,
        };
      });
      const message = getErrorMessage(error);
      setLastError(message);
      throw new Error(message);
    }
  }, []);

  async function updateDefaultModel(provider: string, modelId: string) {
    setLastError(null);

    try {
      await sendClientMessage({
        type: "set_default_model",
        provider,
        modelId,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setLastError(message);
      throw new Error(message);
    }
  }

  async function updateScheduledJob(
    jobId: string,
    changes: ScheduledJobUpdateRequest,
  ) {
    setLastError(null);

    try {
      await sendClientMessage({
        type: "update_job",
        jobId,
        changes,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setLastError(message);
      throw new Error(message);
    }
  }

  async function deleteScheduledJob(jobId: string) {
    setLastError(null);

    try {
      await sendClientMessage({ type: "delete_job", jobId });
    } catch (error) {
      const message = getErrorMessage(error);
      setLastError(message);
      throw new Error(message);
    }
  }

	return { refreshJobs, refreshProviders, refreshJobRuns, updateDefaultModel, updateScheduledJob, deleteScheduledJob };
}
