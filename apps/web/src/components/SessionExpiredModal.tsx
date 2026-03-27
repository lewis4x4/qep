import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";

interface SessionExpiredModalProps {
  open: boolean;
  onSignIn: () => void;
}

export function SessionExpiredModal({
  open,
  onSignIn,
}: SessionExpiredModalProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-sm"
        aria-labelledby="session-expired-title"
        aria-describedby="session-expired-desc"
        // Prevent closing by clicking backdrop — user must sign in
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle id="session-expired-title">
            Session Expired
          </DialogTitle>
          <DialogDescription id="session-expired-desc">
            Your session has timed out for security. Please sign in again to
            continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            onClick={onSignIn}
            className="w-full min-h-[44px]"
            autoFocus
          >
            <LogIn className="w-4 h-4 mr-2" aria-hidden="true" />
            Sign In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
