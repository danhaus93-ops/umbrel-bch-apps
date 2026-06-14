import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  SimpleChanges,
} from '@angular/core';
import { SigInfo, SighashLabels } from '@app/shared/transaction.utils';

@Component({
  selector: 'app-asm',
  templateUrl: './asm.component.html',
  styleUrls: ['./asm.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AsmComponent {
  @Input() asm: string;
  @Input() crop: number = 0;
  @Input() annotations: {
    signatures: Record<string, { sig: SigInfo; vindex: number }>;
    selectedSig: SigInfo | null;
    p2sh: boolean;
  } = {
    signatures: {},
    selectedSig: null,
    p2sh: false,
  };
  @Output() showSigInfo = new EventEmitter<SigInfo>();
  @Output() hideSigInfo = new EventEmitter<void>();

  instructions: { instruction: string; args: string[] }[] = [];
  sighashLabels: Record<number, string> = SighashLabels;

  ngOnInit(): void {
    this.parseASM();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['asm'] || changes['crop']) {
      this.parseASM();
    }
  }

  parseASM(): void {
    let instructions = this.asm.split('OP_');
    // trim instructions to a whole number of instructions with at most `crop` characters total
    if (this.crop && this.asm.length > this.crop) {
      let chars = 0;
      for (let i = 0; i < instructions.length; i++) {
        if (chars + instructions[i].length + 3 > this.crop) {
          const croppedInstruction = instructions[i];
          instructions = instructions.slice(0, i);
          // add cropped instruction
          let remainingChars = this.crop - chars;
          let parts = croppedInstruction.split(' ');
          // only render this instruction if there is space for the instruction name and a few args
          if (remainingChars > parts[0].length + 10) {
            remainingChars -= parts[0].length + 1;
            for (let j = 1; j < parts.length; j++) {
              const arg = parts[j];
              if (remainingChars >= arg.length) {
                remainingChars -= arg.length + 1;
              } else {
                // crop this argument
                parts[j] = arg.slice(0, remainingChars);
                // and remove all following arguments
                parts = parts.slice(0, j + 1);
                break;
              }
            }
            instructions.push(`${parts.join(' ')}`);
          }
          break;
        }
        chars += instructions[i].length + 3;
      }
    }
    this.instructions = instructions
      .filter((instruction) => instruction.trim() !== '')
      .map((instruction) => {
        const parts = instruction.split(' ');
        return {
          instruction: parts[0],
          args: parts.slice(1),
        };
      });
  }

  doShowSigInfo(sig: SigInfo): void {
    this.showSigInfo.emit(sig);
  }

  doHideSigInfo(): void {
    this.hideSigInfo.emit();
  }

  readonly opcodeStyles: Map<string, string> = new Map([
    // Constants
    ['0', 'constants'],
    ['FALSE', 'constants'],
    ['TRUE', 'constants'],
    ...Array.from({ length: 75 }, (_, i) => [
      `PUSHBYTES_${i + 1}`,
      'constants',
    ]),
    ['PUSHDATA1', 'constants'],
    ['PUSHDATA2', 'constants'],
    ['PUSHDATA4', 'constants'],
    ['PUSHNUM_NEG1', 'constants'],
    ...Array.from({ length: 16 }, (_, i) => [`PUSHNUM_${i + 1}`, 'constants']),

    // Control flow
    ['NOP', 'control'],
    ['IF', 'control'],
    ['NOTIF', 'control'],
    ['BEGIN', 'control'],
    ['UNTIL', 'control'],
    ['ELSE', 'control'],
    ['ENDIF', 'control'],
    ['VERIFY', 'control'],
    ['DEFINE', 'control'],
    ['INVOKE', 'control'],
    ['RETURN', 'control'],
    ...Array.from({ length: 70 }, (_, i) => [`RETURN_${i + 186}`, 'control']),

    // Stack
    ['TOALTSTACK', 'stack'],
    ['FROMALTSTACK', 'stack'],
    ['IFDUP', 'stack'],
    ['DEPTH', 'stack'],
    ['DROP', 'stack'],
    ['DUP', 'stack'],
    ['NIP', 'stack'],
    ['OVER', 'stack'],
    ['PICK', 'stack'],
    ['ROLL', 'stack'],
    ['ROT', 'stack'],
    ['SWAP', 'stack'],
    ['TUCK', 'stack'],
    ['2DROP', 'stack'],
    ['2DUP', 'stack'],
    ['3DUP', 'stack'],
    ['2OVER', 'stack'],
    ['2ROT', 'stack'],
    ['2SWAP', 'stack'],

    // String
    ['CAT', 'splice'],
    ['SUBSTR', 'splice'],
    ['NUM2BIN', 'splice'],
    ['BIN2NUM', 'splice'],
    ['LEFT', 'splice'],
    ['RIGHT', 'splice'],
    ['SIZE', 'splice'],
    ['REVERSEBYTES', 'splice'],

    // Logic
    ['INVERT', 'logic'],
    ['AND', 'logic'],
    ['OR', 'logic'],
    ['XOR', 'logic'],
    ['EQUAL', 'logic'],
    ['EQUALVERIFY', 'logic'],

    // Arithmetic
    ['1ADD', 'arithmetic'],
    ['1SUB', 'arithmetic'],
    ['LSHIFTNUM', 'arithmetic'],
    ['RSHIFTNUM', 'arithmetic'],
    ['NEGATE', 'arithmetic'],
    ['ABS', 'arithmetic'],
    ['NOT', 'arithmetic'],
    ['0NOTEQUAL', 'arithmetic'],
    ['ADD', 'arithmetic'],
    ['SUB', 'arithmetic'],
    ['MUL', 'arithmetic'],
    ['DIV', 'arithmetic'],
    ['MOD', 'arithmetic'],
    ['LSHIFTBIN', 'arithmetic'],
    ['RSHIFTBIN', 'arithmetic'],
    ['BOOLAND', 'arithmetic'],
    ['BOOLOR', 'arithmetic'],
    ['NUMEQUAL', 'arithmetic'],
    ['NUMEQUALVERIFY', 'arithmetic'],
    ['NUMNOTEQUAL', 'arithmetic'],
    ['LESSTHAN', 'arithmetic'],
    ['GREATERTHAN', 'arithmetic'],
    ['LESSTHANOREQUAL', 'arithmetic'],
    ['GREATERTHANOREQUAL', 'arithmetic'],
    ['MIN', 'arithmetic'],
    ['MAX', 'arithmetic'],
    ['WITHIN', 'arithmetic'],

    // Crypto
    ['RIPEMD160', 'crypto'],
    ['SHA1', 'crypto'],
    ['SHA256', 'crypto'],
    ['HASH160', 'crypto'],
    ['HASH256', 'crypto'],
    ['CODESEPARATOR', 'crypto'],
    ['CHECKSIG', 'crypto'],
    ['CHECKSIGVERIFY', 'crypto'],
    ['CHECKMULTISIG', 'crypto'],
    ['CHECKMULTISIGVERIFY', 'crypto'],
    ['CHECKSIGADD', 'crypto'],
    ['CHECKDATASIG', 'crypto'],
    ['CHECKDATASIGVERIFY', 'crypto'],

    // Locktime
    ['CLTV', 'locktime'],
    ['CSV', 'locktime'],

    // Introspection
    ['INPUTINDEX', 'introspection'],
    ['ACTIVEBYTECODE', 'introspection'],
    ['TXVERSION', 'introspection'],
    ['TXINPUTCOUNT', 'introspection'],
    ['TXOUTPUTCOUNT', 'introspection'],
    ['TXLOCKTIME', 'introspection'],
    ['UTXOVALUE', 'introspection'],
    ['UTXOBYTECODE', 'introspection'],
    ['OUTPOINTTXHASH', 'introspection'],
    ['OUTPOINTINDEX', 'introspection'],
    ['INPUTBYTECODE', 'introspection'],
    ['INPUTSEQUENCENUMBER', 'introspection'],
    ['OUTPUTVALUE', 'introspection'],
    ['OUTPUTBYTECODE', 'introspection'],
    ['UTXOTOKENCATEGORY', 'introspection'],
    ['UTXOTOKENCOMMITMENT', 'introspection'],
    ['UTXOTOKENAMOUNT', 'introspection'],
    ['OUTPUTTOKENCATEGORY', 'introspection'],
    ['OUTPUTTOKENCOMMITMENT', 'introspection'],
    ['OUTPUTTOKENAMOUNT', 'introspection'],

    // Reserved
    ['RESERVED', 'reserved'],
    ['VER', 'reserved'],
    ['VERIF', 'reserved'],
    ['VERNOTIF', 'reserved'],
    ['NOP1', 'reserved'],
    ['NOP4', 'reserved'],
    ['NOP5', 'reserved'],
    ['NOP6', 'reserved'],
    ['NOP7', 'reserved'],
    ['NOP8', 'reserved'],
    ['NOP9', 'reserved'],
    ['NOP10', 'reserved'],
  ] as [string, string][]);
}
