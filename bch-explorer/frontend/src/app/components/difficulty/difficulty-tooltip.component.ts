import {
  Component,
  ElementRef,
  ViewChild,
  Input,
  OnChanges,
  HostListener,
} from '@angular/core';

@Component({
  selector: 'app-difficulty-tooltip',
  templateUrl: './difficulty-tooltip.component.html',
  styleUrls: ['./difficulty-tooltip.component.scss'],
  standalone: false,
})
export class DifficultyTooltipComponent implements OnChanges {
  @Input() status: string | void;
  @Input() cursorPosition: { x: number; y: number };

  isMobile: boolean;

  tooltipPosition = { x: 0, y: 0 };

  @ViewChild('tooltip') tooltipElement: ElementRef<HTMLCanvasElement>;

  constructor() {
    this.onResize();
  }

  ngOnChanges(changes): void {
    if (changes.cursorPosition && changes.cursorPosition.currentValue) {
      let x = changes.cursorPosition.currentValue.x;
      const y = changes.cursorPosition.currentValue.y - 50;
      if (this.tooltipElement) {
        const elementBounds =
          this.tooltipElement.nativeElement.getBoundingClientRect();
        x -= elementBounds.width / 2;
        x = Math.min(
          Math.max(x, 20),
          window.innerWidth - 20 - elementBounds.width
        );
      }
      this.tooltipPosition = { x, y };
    }
  }

  @HostListener('window:resize')
  onResize(): void {
    this.isMobile = window.innerWidth <= 767.98;
  }
}
