import type { ComponentType } from "react";
import {
  Activity as LActivity,
  ArrowLeft as LArrowLeft,
  ArrowUpDown as LArrowUpDown,
  Ban as LBan,
  Check as LCheck,
  ChevronDown as LChevronDown,
  ChevronLeft as LChevronLeft,
  ChevronRight as LChevronRight,
  ChevronUp as LChevronUp,
  Circle as LCircle,
  CircleAlert as LCircleAlert,
  CircleCheck as LCircleCheck,
  Cloud as LCloud,
  Keyboard as LKeyboard,
  Download as LDownload,
  ExternalLink as LExternalLink,
  FileText as LFileText,
  FileX2 as LFileX2,
  ImageOff as LImageOff,
  Inbox as LInbox,
  Info as LInfo,
  LoaderCircle as LLoaderCircle,
  LogOut as LLogOut,
  Mail as LMail,
  MailCheck as LMailCheck,
  Menu as LMenu,
  Minus as LMinus,
  MoreHorizontal as LMoreHorizontal,
  MoveHorizontal as LMoveHorizontal,
  PenLine as LPenLine,
  Plus as LPlus,
  RefreshCw as LRefreshCw,
  RotateCw as LRotateCw,
  Search as LSearch,
  Settings as LSettings,
  Trash2 as LTrash2,
  TriangleAlert as LTriangleAlert,
  Upload as LUpload,
  X as LX,
  type LucideProps,
} from "lucide-react";

// One place that decides which glyph stands for which idea, all on Lucide's grid with one stroke weight.
export type IconProps = LucideProps;

function icon(Glyph: ComponentType<LucideProps>): ComponentType<IconProps> {
  function Icon({ strokeWidth = 1.75, ...props }: IconProps) {
    return <Glyph strokeWidth={strokeWidth} {...props} />;
  }
  Icon.displayName = Glyph.displayName ?? "Icon";
  return Icon;
}

export const Activity = icon(LActivity);
export const ArrowLeft = icon(LArrowLeft);
export const ArrowUpDown = icon(LArrowUpDown);
export const Ban = icon(LBan);
export const Check = icon(LCheck);
export const CheckIcon = Check;
export const ChevronDown = icon(LChevronDown);
export const ChevronDownIcon = ChevronDown;
export const ChevronLeft = icon(LChevronLeft);
export const ChevronRight = icon(LChevronRight);
export const ChevronRightIcon = ChevronRight;
export const ChevronUpIcon = icon(LChevronUp);
export const CircleIcon = icon(LCircle);
export const CircleAlert = icon(LCircleAlert);
export const CircleCheck = icon(LCircleCheck);
export const Cloud = icon(LCloud);
export const Keyboard = icon(LKeyboard);
export const Download = icon(LDownload);
export const ExternalLink = icon(LExternalLink);
export const FileText = icon(LFileText);
export const FileX2 = icon(LFileX2);
export const ImageOff = icon(LImageOff);
export const Inbox = icon(LInbox);
export const Info = icon(LInfo);
export const LoaderCircle = icon(LLoaderCircle);
export const Loader2 = LoaderCircle;
export const LogOut = icon(LLogOut);
export const Mail = icon(LMail);
export const MailCheck = icon(LMailCheck);
export const Menu = icon(LMenu);
export const Minus = icon(LMinus);
export const MoreHorizontal = icon(LMoreHorizontal);
export const MoveHorizontal = icon(LMoveHorizontal);
export const PenLine = icon(LPenLine);
export const Plus = icon(LPlus);
export const RefreshCw = icon(LRefreshCw);
export const RotateCw = icon(LRotateCw);
export const Search = icon(LSearch);
export const SearchIcon = Search;
export const Settings = icon(LSettings);
export const Trash2 = icon(LTrash2);
export const TriangleAlert = icon(LTriangleAlert);
export const Upload = icon(LUpload);
export const X = icon(LX);
export const XIcon = X;
