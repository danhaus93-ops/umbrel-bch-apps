import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subscription } from 'rxjs';
import { shareReplay } from 'rxjs/operators';

interface WebringSite {
  url: string;
  name: string;
  owner: string;
}

const WEBRING_DATA_URL = `https://raw.githubusercontent.com/BitcoinCash1/bch-webring/refs/heads/main/webring.json`;

// Shared across all instances — fetched once for the lifetime of the app.
let sites$: Observable<WebringSite[]> | null = null;

@Component({
  selector: 'app-bch-webring',
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (current) {
      <div class="webring">
        <h2>BCH Webring</h2>
        <p>
          You are visiting <a [href]="current.url">{{ current.name }}</a> by
          {{ current.owner }}
        </p>
        <nav class="nav">
          <a [href]="prev?.url">&#8592; Prev</a>
          <a [href]="random?.url">Random</a>
          <a [href]="next?.url">Next &#8594;</a>
        </nav>
      </div>
    }
    @if (notFound) {
      <div class="webring">
        <p>Site not found in the webring.</p>
      </div>
    }
  `,
  styleUrls: ['./bch-webring.component.scss'],
})
export class BchWebringComponent implements OnInit, OnDestroy {
  @Input() site: string;

  current: WebringSite | null = null;
  prev: WebringSite | null = null;
  next: WebringSite | null = null;
  random: WebringSite | null = null;
  notFound = false;

  private sub: Subscription;

  constructor(
    private http: HttpClient,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (!sites$) {
      sites$ = this.http
        .get<WebringSite[]>(WEBRING_DATA_URL)
        .pipe(shareReplay(1));
    }

    this.sub = sites$.subscribe((sites) => {
      const index = sites.findIndex((s) => s.url === this.site);
      if (index === -1) {
        this.notFound = true;
      } else {
        this.current = sites[index];
        this.prev = sites[index === 0 ? sites.length - 1 : index - 1];
        this.next = sites[index === sites.length - 1 ? 0 : index + 1];
        const randomIndex =
          sites.length > 1 ? this.randomExcluding(index, sites.length) : index;
        this.random = sites[randomIndex];
      }
      this.cd.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private randomExcluding(exclude: number, length: number): number {
    const r = Math.floor(Math.random() * (length - 1));
    return r >= exclude ? r + 1 : r;
  }
}
